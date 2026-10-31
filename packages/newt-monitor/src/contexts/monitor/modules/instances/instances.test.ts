import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { InstanceCountSeriesDTO, InstancesDTO, ServerSeriesDTO } from './instances'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const GB = 1_000_000_000
const minute = Math.floor(Date.now() / MINUTE) * MINUTE
const ago = (ms: number) => new Date(minute - ms)

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string

beforeEach(async () => {
  monitor = await openTestMonitor()
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

const json = async <T>(path: string) => (await (await as(path)).json()) as T
const collect = () => monitor.modules.instances.collect(id)

/** An instance sampled every 10 seconds of a minute, from one slot to another. */
function sampled(instance: string, at: Date, slots: number[], read: { server?: string, memoryFree?: number, diskFree?: number } = {}) {
  for (const slot of slots) app.sample(instance, { at: new Date(at.getTime() + slot * 10 * SECOND), ...read })
}

describe('instances', () => {
  test('collects each instance as it is now, and how many were alive minute by minute, once', async () => {
    // Two instances on one server 20 minutes ago: `b` came halfway through the minute, and stopped.
    sampled('a', ago(20 * MINUTE), [0, 1, 2, 3, 4, 5], { memoryFree: 3 * GB })
    sampled('b', ago(20 * MINUTE), [3, 4, 5], { memoryFree: 2 * GB })
    await app.stopped('b', ago(19 * MINUTE))
    // `a` still samples: in a minute not closed yet.
    app.sample('a', { at: new Date(Date.now() - 2 * SECOND), memoryFree: 3 * GB })

    expect(await collect()).toMatchObject({ outcome: 'collected', instances: 2, minutes: 2 })
    expect(await collect()).toMatchObject({ outcome: 'collected', minutes: 0 })

    const now = await json<InstancesDTO>(`/api/apps/${id}/instances`)
    expect(now.instances.map(each => [each.instanceId, each.status, each.server])).toEqual([['a', 'alive', 'web-1'], ['b', 'stopped', 'web-1']])
    expect(now.servers).toMatchObject([{ name: 'web-1', memory: { freeBytes: 3 * GB }, instances: { alive: 1, total: 2 } }])

    const count = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=1h&bucket=1m`)
    expect(count.points.filter(point => point.max !== null).map(point => [point.at, point.min, point.max])).toEqual([[ago(20 * MINUTE).toISOString(), 1, 2]])

    const server = await json<ServerSeriesDTO>(`/api/apps/${id}/servers/series?server=web-1&window=1h&bucket=1m`)
    expect(server.disks).toEqual({ '/': 100 * GB })
    // Each server once a minute, as its first instance read it.
    expect(server.points.filter(point => point.memoryFreeBytes !== null).map(point => [point.memoryFreeBytes, point.cpuUsage, point.disks['/']])).toEqual([[3 * GB, 25, 60 * GB]])
    expect((await as(`/api/apps/${id}/servers/series?window=1h`)).status).toBe(400)
    expect((await as(`/api/apps/${id}/instances/count?window=1h&bucket=1d`)).status).toBe(400)
  })

  test('says an instance not heard of is lost, as the application says it', async () => {
    sampled('a', ago(20 * MINUTE), [0, 1])
    await collect()
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).instances).toMatchObject([{ instanceId: 'a', status: 'lost', stoppedAt: null }])
  })

  test('says in how many days a disk fills, at the pace it has filled lately', async () => {
    sampled('a', ago(3 * HOUR), [0], { diskFree: 60 * GB })
    sampled('a', ago(2 * HOUR), [0], { diskFree: 59.5 * GB })
    sampled('a', ago(HOUR), [0], { diskFree: 59 * GB })
    sampled('b', ago(HOUR), [0], { server: 'web-2', diskFree: 70 * GB })
    await collect()
    const [one, two] = (await json<InstancesDTO>(`/api/apps/${id}/instances`)).servers
    // 1 GB in 2 hours: 12 GB a day, and 59 GB left.
    expect(one!.disks[0]!.fullInDays).toBeCloseTo(59 / 12, 3)
    // Read once: no pace yet.
    expect(two!.disks[0]!.fullInDays).toBeNull()
  })

  test('sums whole days, forgets the minutes and the days its retention says are old, and the instances gone a week', async () => {
    // Newest first: the application keeps a day of minutes back from each one it reads.
    sampled('a', ago(5 * MINUTE), [0, 1, 2, 3, 4, 5])
    sampled('a', ago(5 * DAY), [0, 1, 2, 3, 4, 5])
    sampled('b', ago(5 * DAY), [0, 1, 2])
    sampled('c', ago(8 * DAY), [0, 1, 2, 3, 4, 5])
    await app.stopped('c', ago(8 * DAY))
    sampled('a', ago(20 * DAY), [0])
    await collect()
    expect((await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { resourceMinuteDays: 1 } })).status).toBe(400)
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { resourceMinuteDays: 3, dayDays: 10 } })

    await monitor.modules.instances.keep(id)

    const days = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=30d&bucket=1d`)
    const day = (at: Date) => new Date(Math.floor(at.getTime() / DAY) * DAY).toISOString()
    // Eight and five days ago from their summary, the minutes of them gone; twenty days ago forgotten altogether.
    expect(days.points.filter(point => point.max !== null).map(point => [point.at, point.min, point.max]))
      .toEqual([[day(ago(8 * DAY)), 1, 1], [day(ago(5 * DAY)), 1, 2], [day(ago(5 * MINUTE)), 1, 1]])
    const minutes = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=7d&bucket=1h`)
    expect(minutes.points.filter(point => point.max !== null)).toHaveLength(1)
    // `c` stopped eight days ago: forgotten. `b`, lost five days ago, is still listed.
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).instances.map(each => each.instanceId).sort()).toEqual(['a', 'b'])
  })

  test('forgets everything of an application deleted', async () => {
    sampled('a', ago(20 * MINUTE), [0])
    await collect()
    await monitor.modules.instances.forget(id)
    expect(await monitor.modules.instances.list(id)).toEqual({ servers: [], instances: [] })
  })
})
