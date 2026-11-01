import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt-kit/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { UseCaseSeriesDTO, UseCaseTopDTO, UseCaseTotalDTO } from './use-case-metrics'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// The application times by the real clock: its minutes close as real ones do.
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)
/** Within ±5%, as a histogram tells a time. */
const near = (value: number | null, expected: number) => expect(Math.abs(value! - expected) / expected).toBeLessThan(0.05)

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
  app.add('boards', { card: { useCases: ['create'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const json = async <T>(path: string, init?: Parameters<Browser>[1]) => (await (await as(path, init)).json()) as T
const collect = () => monitor.modules.useCaseMetrics.collect(id)
const series = (query: string) => json<UseCaseSeriesDTO>(`/api/apps/${id}/metrics/use-cases/series?context=boards&useCase=card.create&${query}`)

describe('use case metrics', () => {
  test('collects how its calls went, once, with their mean and percentiles', async () => {
    // 90 quick calls of 10 ms, 9 of 100 ms, one of 1 s: the tail is what the percentiles see.
    app.call('boards', 'card.create', { at: ago(20 * MINUTE), ms: 10, times: 90, actor: 'ana', scopes: { workspace: 'acme' } })
    app.call('boards', 'card.create', { at: ago(20 * MINUTE), ms: 100, times: 9, retries: 1, actor: 'bea', scopes: { workspace: 'acme' } })
    app.call('boards', 'card.create', { at: ago(10 * MINUTE), ms: 1000, actor: 'bea', scopes: { workspace: 'globex' } })
    // The hour before: slower.
    app.call('boards', 'card.create', { at: ago(90 * MINUTE), ms: 200, times: 10 })

    expect(await collect()).toMatchObject({ outcome: 'collected', timings: 4 })
    expect(await collect()).toMatchObject({ outcome: 'collected', timings: 0 })

    const hour = await series('window=1h&bucket=5m')
    expect(hour.total).toMatchObject({ calls: 100, retries: 9 })
    near(hour.total.meanMs, (90 * 10 + 9 * 100 + 1000) / 100)
    near(hour.total.p50, 10)
    near(hour.total.p90, 10)
    near(hour.total.p99, 100)
    expect(hour.points).toHaveLength(12)
    expect(hour.points.filter(point => point.calls > 0).map(point => point.calls)).toEqual([99, 1])
    expect(hour.points.find(point => point.calls === 0)).toMatchObject({ meanMs: null, p50: null })

    near((await series('window=1h&actor=bea')).total.p50, 100)
    expect((await series('window=1h&scope=workspace:globex')).total.calls).toBe(1)
    // Every use case of the application: the same, here, with one.
    expect((await json<UseCaseSeriesDTO>(`/api/apps/${id}/metrics/use-cases/series?window=1h`)).total).toMatchObject({ calls: 100, retries: 9 })
    expect((await as(`/api/apps/${id}/metrics/use-cases/series?useCase=card.create&window=1h`)).status).toBe(400)

    const [total] = await json<UseCaseTotalDTO[]>(`/api/apps/${id}/metrics/use-cases?window=1h`)
    expect(total).toMatchObject({ context: 'boards', useCase: 'card.create', now: { calls: 100 }, previous: { calls: 10 } })
    near(total!.now.p90, 10)
    near(total!.previous.p90, 200)
    expect(await json<string[]>(`/api/apps/${id}/metrics/use-cases/scopes?context=boards&useCase=card.create&window=1h`)).toEqual(['workspace'])
    const top = await json<UseCaseTopDTO[]>(`/api/apps/${id}/metrics/use-cases/top?context=boards&useCase=card.create&window=1h&by=actor`)
    expect(top.map(each => [each.value, each.calls])).toEqual([['ana', 90], ['bea', 10]])
    near(top[1]!.p50, 100)
    // Who makes it run again: bea alone, ana never.
    const fought = await json<UseCaseTopDTO[]>(`/api/apps/${id}/metrics/use-cases/top?context=boards&useCase=card.create&window=1h&by=actor&order=retries`)
    expect(fought.map(each => [each.value, each.retries])).toEqual([['bea', 9]])
  })

  test('keeps the days without actor, with their percentiles, and forgets what is old', async () => {
    // Newest first: the application keeps a day of minutes back from each one it times.
    app.call('boards', 'card.create', { at: ago(10 * MINUTE), ms: 20, actor: 'ana' })
    app.call('boards', 'card.create', { at: ago(5 * DAY), ms: 50, times: 4, actor: 'ana' })
    app.call('boards', 'card.create', { at: ago(20 * DAY), ms: 50, times: 2, actor: 'bea' })
    await collect()
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3, dayDays: 10 } })

    await monitor.modules.useCaseMetrics.keepAll()

    const days = await series('window=30d&bucket=1d&compare=none')
    expect(days.total.calls).toBe(5)
    near(days.total.p50, 50)
    expect(days.points.filter(point => point.calls > 0).map(point => point.calls)).toEqual([4, 1])
    expect((await series('window=30d&bucket=1d&actor=ana&compare=none')).total.calls).toBe(1)
  })

  test('totals a window longer than the minutes kept from the day summary, and the window before it too', async () => {
    app.call('boards', 'card.create', { at: ago(10 * MINUTE), ms: 20 })
    app.call('boards', 'card.create', { at: ago(5 * DAY), ms: 50, times: 4 })
    app.call('boards', 'card.create', { at: ago(100 * DAY), ms: 200, times: 2 })
    await collect()
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3 } })

    await monitor.modules.useCaseMetrics.keepAll()

    const [total] = await json<UseCaseTotalDTO[]>(`/api/apps/${id}/metrics/use-cases?window=90d`)
    expect(total).toMatchObject({ context: 'boards', useCase: 'card.create', now: { calls: 5 }, previous: { calls: 2 } })
    near(total!.now.p50, 50)
    near(total!.previous.p50, 200)
  })

  test('forgets everything of a deleted application', async () => {
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    expect(await collect()).toEqual({ appId: id, outcome: 'archived' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })
    await monitor.monitor.base.jobs.idle()
    expect(await collect()).toEqual({ appId: id, outcome: 'gone' })
  })
})
