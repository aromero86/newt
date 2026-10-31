import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { RetentionDTO } from '../retention/retention.schema'
import type { EventTotalDTO, SeriesDTO, TopDTO } from './event-metrics'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// The application counts by the real clock: its minutes close as real ones do.
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)

let time: number
const clock = { now: () => new Date(time) }
let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  time = Date.now()
  monitor = await openTestMonitor({ clock })
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('boards', { card: { useCases: ['create'], events: ['created'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const json = async <T>(path: string, init?: Parameters<Browser>[1]) => (await (await as(path, init)).json()) as T
const collect = () => monitor.modules.eventMetrics.collect(id)

describe('event metrics', () => {
  test('collects the minutes an application closed, once, and draws an event by bucket, scope and actor', async () => {
    app.tell('boards', 'card.created', { at: ago(30 * MINUTE), actor: 'ana', scopes: { workspace: 'acme' }, times: 3 })
    app.tell('boards', 'card.created', { at: ago(10 * MINUTE), actor: 'bea', scopes: { workspace: 'acme' } })
    app.tell('boards', 'card.created', { at: ago(10 * MINUTE), actor: 'ana', scopes: { workspace: 'globex' } })

    expect(await collect()).toMatchObject({ outcome: 'collected', counts: 3 })
    // Collected again from its cursor: nothing new, nothing counted twice.
    expect(await collect()).toMatchObject({ outcome: 'collected', counts: 0 })

    const series = await json<SeriesDTO>(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=1h&bucket=5m`)
    expect(series).toMatchObject({ window: '1h', bucket: '5m', total: 5, comparedTotal: 0 })
    expect(series.points).toHaveLength(12)
    expect(series.points.filter(point => point.count > 0).map(point => point.count)).toEqual([3, 2])

    const acme = await json<SeriesDTO>(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=1h&scope=workspace:acme`)
    expect(acme.total).toBe(4)
    const ana = await json<SeriesDTO>(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=1h&actor=ana`)
    expect(ana.total).toBe(4)

    expect(await json<TopDTO[]>(`/api/apps/${id}/metrics/events/top?context=boards&event=card.created&window=1h&by=actor`)).toEqual([{ value: 'ana', count: 4 }, { value: 'bea', count: 1 }])
    expect(await json<TopDTO[]>(`/api/apps/${id}/metrics/events/top?context=boards&event=card.created&window=1h&by=scope:workspace`)).toEqual([{ value: 'acme', count: 4 }, { value: 'globex', count: 1 }])
    expect(await json<EventTotalDTO[]>(`/api/apps/${id}/metrics/events?window=1h`)).toEqual([{ context: 'boards', event: 'card.created', total: 5, previous: 0 }])
    expect(await json<string[]>(`/api/apps/${id}/metrics/events/scopes?context=boards&event=card.created&window=1h`)).toEqual(['workspace'])
  })

  test('compares a window with the one before it, drawn at its buckets\' times', async () => {
    app.tell('boards', 'card.created', { at: ago(90 * MINUTE), times: 2 })
    app.tell('boards', 'card.created', { at: ago(20 * MINUTE) })
    await collect()

    const series = await json<SeriesDTO>(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=1h&bucket=5m`)
    expect([series.total, series.comparedTotal]).toEqual([1, 2])
    expect(series.compared!.map(point => point.at)).toEqual(series.points.map(point => point.at))
    expect(await json<EventTotalDTO[]>(`/api/apps/${id}/metrics/events?window=1h`)).toEqual([{ context: 'boards', event: 'card.created', total: 1, previous: 2 }])
  })

  test('passes the application\'s counts on live, as they come', async () => {
    const live = await as(`/api/apps/${id}/metrics/live`)
    expect(live.headers.get('content-type')).toBe('text/event-stream')
    const reader = live.body!.getReader()
    const read = async () => new TextDecoder().decode((await reader.read()).value)

    expect(await read()).toContain(': live')
    app.tell('boards', 'card.created', { at: new Date(), actor: 'ana' })
    expect(await read()).toContain('"event":"card.created","scopes":{},"actor":"ana","count":1')
    await reader.cancel()
  })

  test('refuses a bucket its window is not drawn in', async () => {
    const answer = await as(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=30d&bucket=1m`)
    expect(answer.status).toBe(400)
  })

  test('sums whole days, and forgets the minutes and the days its retention says are old', async () => {
    // Newest first: the application keeps a day of minutes back from each one it counts.
    app.tell('boards', 'card.created', { at: ago(10 * MINUTE), actor: 'ana' })
    app.tell('boards', 'card.created', { at: ago(5 * DAY), actor: 'ana', times: 4 })
    app.tell('boards', 'card.created', { at: ago(20 * DAY), actor: 'bea', times: 2 })
    await collect()
    expect(await json<RetentionDTO>(`/api/apps/${id}/retention`)).toEqual({ minuteDays: 30, dayDays: null, traceDays: 7, resourceMinuteDays: 30 })
    expect((await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 1 } })).status).toBe(400)
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3, dayDays: 10 } })

    await monitor.modules.eventMetrics.keepAll()

    // The 30 days, by day: five days ago from the summary, today from the minutes; twenty days ago is gone.
    const days = await json<SeriesDTO>(`/api/apps/${id}/metrics/events/series?context=boards&event=card.created&window=30d&bucket=1d&compare=none`)
    expect(days.total).toBe(5)
    expect(days.points.filter(point => point.count > 0).map(point => point.count)).toEqual([4, 1])
    // By actor only what the minutes keep: three days.
    expect(await json<TopDTO[]>(`/api/apps/${id}/metrics/events/top?context=boards&event=card.created&window=30d&by=actor`)).toEqual([{ value: 'ana', count: 1 }])
  })

  test('totals a window longer than the minutes kept from the day summary, and the window before it too', async () => {
    app.tell('boards', 'card.created', { at: ago(10 * MINUTE) })
    app.tell('boards', 'card.created', { at: ago(5 * DAY), times: 4 })
    app.tell('boards', 'card.created', { at: ago(100 * DAY), times: 2 })
    await collect()
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3 } })

    await monitor.modules.eventMetrics.keepAll()

    expect(await json<EventTotalDTO[]>(`/api/apps/${id}/metrics/events?window=90d`)).toEqual([{ context: 'boards', event: 'card.created', total: 5, previous: 2 }])
    expect(await json<EventTotalDTO[]>(`/api/apps/${id}/metrics/events?window=1h`)).toEqual([{ context: 'boards', event: 'card.created', total: 1, previous: 0 }])
  })

  test('collects nothing of an archived application, and forgets everything of a deleted one', async () => {
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    expect(await collect()).toEqual({ appId: id, outcome: 'archived' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })
    await monitor.monitor.base.jobs.idle()
    expect(await collect()).toEqual({ appId: id, outcome: 'gone' })
  })
})
