import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { ErrorCodeDTO, ErrorsSeriesDTO, ErrorsTopDTO, ErrorsTotalDTO } from './use-case-errors'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)
const notFound = { kind: 'error', code: 'card.not_found' } as const
const broken = { kind: 'failure', code: 'TypeError' } as const

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  monitor = await openTestMonitor()
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('boards', { card: { useCases: ['get'] } })
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })).json() as { id: string }).id
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const json = async <T>(path: string, init?: Parameters<Browser>[1]) => (await (await as(path, init)).json()) as T
const collect = () => monitor.modules.useCaseErrors.collect(id)
const query = 'context=boards&useCase=card.get&window=1h'

describe('use case errors', () => {
  test('keeps how its calls ended badly, once, by code, actor and scope', async () => {
    app.call('boards', 'card.get', { at: ago(20 * MINUTE), ms: 3, times: 50, actor: 'ana', scopes: { workspace: 'acme' } })
    app.call('boards', 'card.get', { at: ago(20 * MINUTE), ms: 3, times: 4, actor: 'ana', scopes: { workspace: 'acme' }, outcome: notFound })
    app.call('boards', 'card.get', { at: ago(10 * MINUTE), ms: 3, times: 2, actor: 'bea', scopes: { workspace: 'globex' }, outcome: broken })
    app.call('boards', 'card.get', { at: ago(90 * MINUTE), ms: 3, actor: 'bea', outcome: notFound })

    expect(await collect()).toMatchObject({ outcome: 'collected', counted: 3 })
    expect(await collect()).toMatchObject({ outcome: 'collected', counted: 0 })

    const series = await json<ErrorsSeriesDTO>(`/api/apps/${id}/metrics/errors/series?${query}&bucket=5m`)
    expect(series.total).toEqual({ errors: 4, failures: 2 })
    expect(series.points.filter(point => point.errors + point.failures > 0).map(point => [point.errors, point.failures])).toEqual([[4, 0], [0, 2]])
    expect((await json<ErrorsSeriesDTO>(`/api/apps/${id}/metrics/errors/series?${query}&actor=bea`)).total).toEqual({ errors: 0, failures: 2 })
    // Of every use case of the application: the same, here, with one.
    expect((await json<ErrorsSeriesDTO>(`/api/apps/${id}/metrics/errors/series?window=1h`)).total).toEqual({ errors: 4, failures: 2 })
    expect((await as(`/api/apps/${id}/metrics/errors/series?context=boards&window=1h`)).status).toBe(400)

    expect(await json<ErrorsTotalDTO[]>(`/api/apps/${id}/metrics/errors?window=1h`)).toEqual([
      { context: 'boards', useCase: 'card.get', now: { errors: 4, failures: 2 }, previous: { errors: 1, failures: 0 } },
    ])
    expect(await json<ErrorCodeDTO[]>(`/api/apps/${id}/metrics/errors/codes?${query}`)).toEqual([
      { kind: 'error', code: 'card.not_found', count: 4, previous: 1 },
      { kind: 'failure', code: 'TypeError', count: 2, previous: 0 },
    ])
    expect(await json<ErrorsTopDTO[]>(`/api/apps/${id}/metrics/errors/top?${query}&by=actor`)).toEqual([{ value: 'bea', errors: 0, failures: 2 }])
    expect(await json<ErrorsTopDTO[]>(`/api/apps/${id}/metrics/errors/top?${query}&by=scope:workspace&kind=error`)).toEqual([{ value: 'acme', errors: 4, failures: 0 }])
  })

  test('keeps the days without actor, and forgets what is old', async () => {
    app.call('boards', 'card.get', { at: ago(10 * MINUTE), ms: 3, outcome: broken })
    app.call('boards', 'card.get', { at: ago(5 * DAY), ms: 3, times: 3, actor: 'ana', outcome: broken })
    app.call('boards', 'card.get', { at: ago(20 * DAY), ms: 3, outcome: broken })
    await collect()
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3, dayDays: 10 } })

    await monitor.modules.useCaseErrors.keepAll()

    const days = await json<ErrorsSeriesDTO>(`/api/apps/${id}/metrics/errors/series?context=boards&useCase=card.get&window=30d&bucket=1d`)
    expect(days.total).toEqual({ errors: 0, failures: 4 })
  })

  test('forgets everything of a deleted application', async () => {
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    expect(await collect()).toEqual({ appId: id, outcome: 'archived' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })
    await monitor.monitor.base.jobs.idle()
    expect(await collect()).toEqual({ appId: id, outcome: 'gone' })
  })
})
