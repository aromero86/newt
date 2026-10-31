import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { QueueSeriesDTO, QueueTotalDTO } from './queue-metrics'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)
const QUEUE = 'card.indexCard.on.card.created'
const near = (value: number | null, expected: number) => expect(Math.abs(value! - expected) / expected).toBeLessThan(0.05)

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
const collect = () => monitor.modules.queueMetrics.collect(id)

describe('queue metrics', () => {
  test('collects how each queue flowed, once: in, out, again, dead, and how long jobs waited', async () => {
    app.flow('boards', QUEUE, { at: ago(20 * MINUTE), kind: 'published', times: 12 })
    app.flow('boards', QUEUE, { at: ago(20 * MINUTE), kind: 'delivered', waitMs: 40, times: 9 })
    app.flow('boards', QUEUE, { at: ago(20 * MINUTE), kind: 'redelivered', waitMs: 40, times: 2 })
    app.flow('boards', QUEUE, { at: ago(10 * MINUTE), kind: 'dead', waitMs: 2000 })
    app.flow('boards', QUEUE, { at: ago(90 * MINUTE), kind: 'published', times: 3 })

    expect(await collect()).toMatchObject({ outcome: 'collected', flows: 3 })
    expect(await collect()).toMatchObject({ outcome: 'collected', flows: 0 })

    const series = await json<QueueSeriesDTO>(`/api/apps/${id}/metrics/queues/series?context=boards&queue=${QUEUE}&window=1h&bucket=5m`)
    expect(series.total).toMatchObject({ published: 12, delivered: 9, redelivered: 2, dead: 1 })
    near(series.total.waitP50, 40)
    near(series.total.waitP99, 2000)
    expect(series.comparedTotal).toMatchObject({ published: 3, delivered: 0 })
    expect(series.points.filter(point => point.published + point.dead > 0).map(point => [point.published, point.dead])).toEqual([[12, 0], [0, 1]])

    // Every queue of the application, summed: another one's jobs add to these.
    app.flow('boards', 'card.notify.on.card.created', { at: ago(20 * MINUTE), kind: 'published', times: 5 })
    await monitor.monitor.base.jobs.idle()
    expect(await collect()).toMatchObject({ outcome: 'collected' })
    const all = await json<QueueSeriesDTO>(`/api/apps/${id}/metrics/queues/series?window=1h&bucket=5m`)
    expect(all.total).toMatchObject({ published: 12, delivered: 9, dead: 1 })
    expect((await as(`/api/apps/${id}/metrics/queues/series?queue=${QUEUE}&window=1h`)).status).toBe(400)

    const [total] = await json<QueueTotalDTO[]>(`/api/apps/${id}/metrics/queues?window=1h`)
    expect(total).toMatchObject({ context: 'boards', queue: QUEUE, now: { published: 12, delivered: 9, dead: 1 }, previous: { published: 3 } })
    near(total!.now.waitP90, 40)
  })

  test('keeps the days, and forgets what is old', async () => {
    app.flow('boards', QUEUE, { at: ago(10 * MINUTE), kind: 'published' })
    app.flow('boards', QUEUE, { at: ago(5 * DAY), kind: 'published', times: 4 })
    app.flow('boards', QUEUE, { at: ago(20 * DAY), kind: 'published', times: 2 })
    await collect()
    await monitor.modules.retention.change(id, { minuteDays: 3, dayDays: 10 })

    await monitor.modules.queueMetrics.keepAll()

    const days = await json<QueueSeriesDTO>(`/api/apps/${id}/metrics/queues/series?context=boards&queue=${QUEUE}&window=30d&bucket=1d&compare=none`)
    expect(days.total.published).toBe(5)
  })
})
