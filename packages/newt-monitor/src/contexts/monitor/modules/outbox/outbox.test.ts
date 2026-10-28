import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DeadJobs } from 'newt/contract'
import type { Job } from 'newt/port-outbox'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { DepthSeriesDTO, OutboxNowDTO } from './outbox.schema'

const QUEUE = 'card.indexCard.on.card.created'
const depth = (ready: number, dead = 0) => ({ queue: QUEUE, ready, retrying: 1, running: 2, dead, oldestDueAt: new Date(Date.now() - 30_000).toISOString() })
const deadJob = (id: string): Job => ({
  id, queue: QUEUE, event: JSON.stringify({ name: 'card.created', payload: { email: 'ana@example.com' } }), status: 'dead', attempts: 5,
  runAfter: '2026-01-01T00:00:00.000Z', lockedBy: null, lockedUntil: null, lastError: 'Error: the index is down', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z',
})

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('boards', { card: { useCases: ['indexCard'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const json = async <T>(path: string) => (await (await as(path)).json()) as T

describe('outbox', () => {
  test('keeps a snapshot of how full each queue is, and says the last one', async () => {
    expect(await json<OutboxNowDTO>(`/api/apps/${id}/outbox`)).toEqual({ at: null, queues: [] })
    app.queues('boards', [depth(7, 1)])

    expect(await monitor.modules.outbox.snapshot(id)).toMatchObject({ outcome: 'taken', queues: 1 })
    // Taken twice in a minute, kept once.
    await monitor.modules.outbox.snapshot(id)

    const now = await json<OutboxNowDTO>(`/api/apps/${id}/outbox`)
    expect(now.queues).toHaveLength(1)
    // No worker of the test application serves it, and it has jobs to run: an orphan.
    expect(now.queues[0]).toMatchObject({ context: 'boards', queue: QUEUE, ready: 7, retrying: 1, running: 2, dead: 1, orphan: true })
    expect(now.queues[0]!.oldestWaitMs).toBeGreaterThan(29_000)

    const series = await json<DepthSeriesDTO>(`/api/apps/${id}/outbox/depth?context=boards&queue=${QUEUE}&window=1h&bucket=5m`)
    expect(series.points).toHaveLength(12)
    expect(series.points.filter(point => point.ready !== null)).toEqual([expect.objectContaining({ ready: 7, dead: 1 })])
  })

  test('sums every queue of the application, each at its most in a bucket', async () => {
    app.queues('boards', [depth(7, 1), { ...depth(3), queue: 'card.notify.on.card.created' }])
    await monitor.modules.outbox.snapshot(id)
    app.queues('boards', [depth(2, 1), { ...depth(5), queue: 'card.notify.on.card.created' }])
    // Another snapshot in the same minute is not kept: the first stands.
    await monitor.modules.outbox.snapshot(id)

    const all = await json<DepthSeriesDTO>(`/api/apps/${id}/outbox/depth?window=1h&bucket=5m`)
    expect(all.points.filter(point => point.ready !== null)).toEqual([expect.objectContaining({ ready: 10, retrying: 2, running: 4, dead: 1 })])
    expect((await as(`/api/apps/${id}/outbox/depth?context=boards&window=1h`)).status).toBe(400)
  })

  test('lists a context\'s dead jobs as the application says them, never their payloads', async () => {
    app.queues('boards', [depth(0, 2)], [deadJob('j1'), deadJob('j2')])

    const page = await json<DeadJobs>(`/api/apps/${id}/outbox/dead?context=boards&limit=1`)
    expect(page.hasMore).toBe(true)
    expect(page.jobs).toEqual([{ id: 'j1', queue: QUEUE, event: 'card.created', attempts: 5, lastError: 'Error: the index is down', createdAt: '2026-01-01T00:00:00.000Z', diedAt: '2026-01-01T00:05:00.000Z' }])
    expect(JSON.stringify(page)).not.toContain('ana@example.com')
  })

  test('says why there are none when the application does not answer', async () => {
    await app.stop()
    const answer = await as(`/api/apps/${id}/outbox/dead?context=boards`)
    expect([answer.status, ((await answer.json()) as { code: string }).code]).toEqual([409, 'outbox.unreachable'])
    app.start()
  })
})
