import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import { signTraceHeader } from 'newt/monitor'
import type { TraceDTO, TraceHeaderDTO, TraceListDTO } from './traces'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)
const QUEUE = 'card.indexCard.on.card.created'

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('boards', { card: { useCases: ['create', 'indexCard'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const json = async <T>(path: string) => (await (await as(path)).json()) as T
const collect = () => monitor.modules.traces.collect(id)
const ids = (list: TraceListDTO) => list.traces.map(trace => trace.id)

describe('traces', () => {
  test('collects the traces the application kept, once, and lists them newest first, a page at a time', async () => {
    const older = app.trace({ at: ago(30 * MINUTE), calls: [{ context: 'boards', useCase: 'card.create', ms: 8 }] })
    const newer = app.trace({ at: ago(10 * MINUTE), calls: [{ context: 'boards', useCase: 'card.create', ms: 4 }] })

    expect(await collect()).toMatchObject({ outcome: 'collected', traces: 2 })
    expect(await collect()).toMatchObject({ outcome: 'collected', traces: 0 })

    const first = await json<TraceListDTO>(`/api/apps/${id}/traces?limit=1`)
    expect(ids(first)).toEqual([newer])
    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?limit=1&before=${encodeURIComponent(first.next!)}`))).toEqual([older])
  })

  test('finds a use case\'s, by how they went or how long its call took: a percentile\'s examples', async () => {
    const call = (ms: number, outcome?: { kind: 'error' | 'failure', code: string }) => app.trace({ at: ago(5 * MINUTE), outcome, calls: [{ context: 'boards', useCase: 'card.create', ms, outcome }] })
    const fast = call(5)
    const slow = call(900)
    const failed = call(40, { kind: 'failure', code: 'TypeError' })
    const invalid = call(2, { kind: 'error', code: 'validation' })
    const retried = app.trace({ at: ago(5 * MINUTE), retried: true, calls: [{ context: 'boards', useCase: 'card.create', ms: 60 }] })
    app.trace({ at: ago(5 * MINUTE), calls: [{ context: 'boards', useCase: 'card.indexCard', ms: 1 }] })
    await collect()

    const of = (query: string) => json<TraceListDTO>(`/api/apps/${id}/traces?context=boards&useCase=card.create&${query}`)
    expect((await of('show=all')).traces).toHaveLength(5)
    expect(ids(await of('show=failures'))).toEqual([failed])
    expect(ids(await of('show=errors'))).toEqual([invalid])
    expect(ids(await of('show=retried'))).toEqual([retried])
    expect(ids(await of('show=slow&limit=2'))).toEqual([slow, retried])
    expect(ids(await of('nearMs=6&limit=1'))).toEqual([fast])
    expect((await of('show=slow&limit=1')).traces[0]!.callMs).toBe(900)
    expect((await as(`/api/apps/${id}/traces?useCase=card.create`)).status).toBe(400)
  })

  test('finds those kept because something asked, and says why', async () => {
    const asked = app.trace({ at: ago(5 * MINUTE), forced: 'a large order', calls: [{ context: 'boards', useCase: 'card.create', ms: 3 }] })
    app.trace({ at: ago(5 * MINUTE), calls: [{ context: 'boards', useCase: 'card.create', ms: 3 }] })
    await collect()

    const forced = await json<TraceListDTO>(`/api/apps/${id}/traces?show=forced`)
    expect(forced.traces.map(trace => [trace.id, trace.forced])).toEqual([[asked, 'a large order']])
  })

  test('keeps each trace\'s log lines: whole in the trace, and finds those that warned or failed', async () => {
    const warned = app.trace({ at: ago(5 * MINUTE), logs: [{ spanId: '1', atMs: 2, level: 'info', message: 'moved', fields: { cardId: 'c-1' } }, { spanId: '1', atMs: 3, level: 'warn', message: 'slow board', fields: {} }] })
    app.trace({ at: ago(5 * MINUTE), logs: [{ spanId: '1', atMs: 1, level: 'info', message: 'fine', fields: {} }] })
    await collect()

    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?show=logged`))).toEqual([warned])
    const trace = await json<TraceDTO>(`/api/apps/${id}/traces/${warned}`)
    expect(trace.logs.map(line => [line.level, line.message, line.fields])).toEqual([['info', 'moved', { cardId: 'c-1' }], ['warn', 'slow board', {}]])
  })

  test('gives the header that keeps a request\'s trace: signed with the application\'s key, for an hour unless asked', async () => {
    const header = await (await as(`/api/apps/${id}/traces/header`, { method: 'POST', json: {} })).json() as TraceHeaderDTO
    const inAnHour = new Date(header.expiresAt).getTime() - Date.now()

    expect(header.name).toBe('x-newt-trace')
    expect(header.value).toBe(signTraceHeader(app.key, new Date(header.expiresAt)))
    expect(inAnHour).toBeGreaterThan(59 * MINUTE)
    expect(inAnHour).toBeLessThanOrEqual(60 * MINUTE)
    expect((await as(`/api/apps/${id}/traces/header`, { method: 'POST', json: { hours: 48 } })).status).toBe(400)
  })

  test('links a job\'s run to the trace that told its event, to the traces it caused, and to its other runs', async () => {
    const told = app.trace({ at: ago(20 * MINUTE), told: [{ id: 'event-1', name: 'card.created', context: 'boards' }], calls: [{ context: 'boards', useCase: 'card.create', ms: 3 }] })
    const job = (run: number, outcome?: { kind: 'failure', code: string }) => app.trace({ at: ago((20 - run) * MINUTE), outcome, retried: run > 1, job: { id: 'job-1', queue: QUEUE, run, event: 'card.created', eventId: 'event-1' } })
    const first = job(1, { kind: 'failure', code: 'Error' })
    const second = job(2)
    await collect()

    const trace = await json<TraceDTO>(`/api/apps/${id}/traces/${second}`)
    expect(trace.causedBy?.id).toBe(told)
    expect(trace.runs.map(run => [run.id, run.job!.run])).toEqual([[first, 1], [second, 2]])
    expect((await json<TraceDTO>(`/api/apps/${id}/traces/${told}`)).caused.map(each => each.id)).toEqual([first, second])
    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?job=job-1`))).toEqual([second, first])
    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?queue=${QUEUE}&show=failures`))).toEqual([first])
    expect(trace.job).toMatchObject({ event: 'card.created', eventId: 'event-1' })
    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?context=boards&told=card.created`))).toEqual([told])
    expect((await as(`/api/apps/${id}/traces?told=card.created`)).status).toBe(400)
    expect((await as(`/api/apps/${id}/traces/nothing`)).status).toBe(404)
  })

  test('forgets what its retention says is old, and everything once its application is deleted', async () => {
    const old = app.trace({ at: ago(3 * DAY) })
    const recent = app.trace({ at: ago(10 * MINUTE) })
    await collect()
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { traceDays: 2 } })

    await monitor.modules.traces.keepAll()
    expect(ids(await json<TraceListDTO>(`/api/apps/${id}/traces?window=7d`))).toEqual([recent])
    expect((await as(`/api/apps/${id}/traces/${old}`)).status).toBe(404)

    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })
    await monitor.monitor.base.jobs.idle()
    // Its DuckDB dropped: nothing of it is kept again, nor read.
    expect(await collect()).toEqual({ appId: id, outcome: 'gone' })
    expect((await as(`/api/apps/${id}/traces?window=7d`)).status).toBe(404)
  })
})
