import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Browser } from '@newt-kit/newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { InstanceCountSeriesDTO, InstancesDTO, SystemSeriesDTO } from './instances'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const GB = 1_000_000_000
const MB = 1_000_000
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
function sampled(instance: string, at: Date, slots: number[], read: { rss?: number, cpu?: number, loopMaxMs?: number, memoryTotal?: number, memoryFree?: number, diskFree?: number } = {}) {
  for (const slot of slots) app.sample(instance, { at: new Date(at.getTime() + slot * 10 * SECOND), ...read })
}

describe('instances', () => {
  test('collects each instance as it is now, and the system minute by minute, once, whatever machines it ran on', async () => {
    // Two instances 20 minutes ago, each on a machine of its own: `b` came halfway through the minute, and stopped.
    sampled('a', ago(20 * MINUTE), [0, 1, 2, 3, 4, 5], { rss: 100 * MB, cpu: 10, loopMaxMs: 4, memoryFree: 3 * GB, diskFree: 60 * GB })
    sampled('b', ago(20 * MINUTE), [3, 4, 5], { rss: 50 * MB, cpu: 5, loopMaxMs: 9, memoryFree: 2 * GB, diskFree: 70 * GB })
    await app.stopped('b', ago(19 * MINUTE))
    // `a` still samples: in a minute not closed yet.
    app.sample('a', { at: new Date(Date.now() - 2 * SECOND), rss: 120 * MB, memoryFree: 3 * GB })

    expect(await collect()).toMatchObject({ outcome: 'collected', instances: 2, minutes: 2 })
    expect(await collect()).toMatchObject({ outcome: 'collected', minutes: 0 })

    const now = await json<InstancesDTO>(`/api/apps/${id}/instances`)
    expect(now.instances.map(each => [each.instanceId, each.status])).toEqual([['a', 'alive'], ['b', 'stopped']])
    // Only `a` is alive: the system now is what it reads.
    expect(now.system).toMatchObject({ instances: 1, process: { rssBytes: 120 * MB }, memory: { freeBytes: 3 * GB }, disks: [{ path: '/', freeBytes: 60 * GB }] })

    const count = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=1h&bucket=1m`)
    expect(count.points.filter(point => point.max !== null).map(point => [point.at, point.min, point.max])).toEqual([[ago(20 * MINUTE).toISOString(), 1, 2]])

    const system = await json<SystemSeriesDTO>(`/api/apps/${id}/system/series?window=1h&bucket=1m`)
    expect(system.disks).toEqual({ '/': 100 * GB })
    // The processes added up slot by slot (`b` only in the last three), the worst event loop, the fullest machine and the fullest disk.
    expect(system.points.filter(point => point.rssBytes !== null).map(point => [point.rssBytes, point.rssMaxBytes, point.cpu, point.loopMaxMs, point.memoryFreeBytes, point.disks['/']]))
      .toEqual([[125 * MB, 150 * MB, 12.5, 9, 2 * GB, 60 * GB]])
    expect((await as(`/api/apps/${id}/system/series?window=1h&bucket=1d`)).status).toBe(400)
    expect((await as(`/api/apps/${id}/instances/count?window=1h&bucket=1d`)).status).toBe(400)
  })

  test('draws one line across a deployment: the new instance, on a new machine, goes on where the old one stopped', async () => {
    sampled('old', ago(30 * MINUTE), [0, 1, 2, 3, 4, 5], { rss: 100 * MB })
    await app.stopped('old', ago(29 * MINUTE))
    sampled('new', ago(29 * MINUTE), [0, 1, 2, 3, 4, 5], { rss: 110 * MB })
    await collect()

    const system = await json<SystemSeriesDTO>(`/api/apps/${id}/system/series?window=1h&bucket=1m`)
    expect(system.points.filter(point => point.rssBytes !== null).map(point => [point.at, point.rssBytes]))
      .toEqual([[ago(30 * MINUTE).toISOString(), 100 * MB], [ago(29 * MINUTE).toISOString(), 110 * MB]])
  })

  test('adds up in each slot only the instances alive together, and reads each machine\'s total with its own free memory', async () => {
    // A restart within one minute, onto a smaller machine: `old` for its first two slots, `new` for its last three.
    sampled('old', ago(30 * MINUTE), [0, 1], { rss: 100 * MB, cpu: 10, memoryTotal: 16 * GB, memoryFree: 1 * GB })
    await app.stopped('old', ago(30 * MINUTE - 15 * SECOND))
    sampled('new', ago(30 * MINUTE), [3, 4, 5], { rss: 100 * MB, cpu: 10, memoryTotal: 4 * GB, memoryFree: GB / 2 })
    await collect()

    const system = await json<SystemSeriesDTO>(`/api/apps/${id}/system/series?window=1h&bucket=1m`)
    const [point] = system.points.filter(point => point.rssBytes !== null)
    // Five of the six slots had one instance, none had two; the fuller machine is the bigger one, by share.
    expect(point!.rssBytes).toBeCloseTo(100 * MB * 5 / 6)
    expect(point!.cpu).toBeCloseTo(10 * 5 / 6)
    expect([point!.rssMaxBytes, point!.cpuMax, point!.memoryTotalBytes, point!.memoryFreeBytes]).toEqual([100 * MB, 10, 16 * GB, 1 * GB])

    // Both alive now, each on its machine: the system now reads the fuller one too.
    app.sample('a', { at: new Date(Date.now() - 2 * SECOND), memoryTotal: 4 * GB, memoryFree: GB / 2 })
    app.sample('b', { at: new Date(Date.now() - 2 * SECOND), memoryTotal: 16 * GB, memoryFree: 1 * GB })
    await collect()
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).system?.memory).toEqual({ totalBytes: 16 * GB, freeBytes: 1 * GB })
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
    app.sample('a', { at: new Date(Date.now() - 2 * SECOND), diskFree: 59 * GB })
    await collect()
    // 1 GB in 2 hours: 12 GB a day, and 59 GB left.
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).system!.disks[0]!.fullInDays).toBeCloseTo(59 / 12, 3)
  })

  test('says nothing of when a disk fills while it has been read too briefly', async () => {
    sampled('a', ago(HOUR), [0], { diskFree: 59 * GB })
    app.sample('a', { at: new Date(Date.now() - 2 * SECOND), diskFree: 58 * GB })
    await collect()
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).system!.disks[0]!.fullInDays).toBeNull()
  })

  test('sums whole days, forgets the minutes and the days its retention says are old, and the instances gone a day', async () => {
    // Newest first: the application keeps a day of minutes back from each one it reads.
    sampled('a', ago(5 * MINUTE), [0, 1, 2, 3, 4, 5])
    sampled('a', ago(5 * DAY), [0, 1, 2, 3, 4, 5])
    sampled('b', ago(5 * DAY), [0, 1, 2])
    sampled('c', ago(8 * DAY), [0, 1, 2, 3, 4, 5])
    await app.stopped('c', ago(8 * DAY))
    sampled('a', ago(20 * DAY), [0])
    await collect()
    expect((await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { resourceMinuteDays: 1 } })).status).toBe(400)
    await as(`/api/apps/${id}/retention`, { method: 'PATCH', json: { minuteDays: 3, resourceMinuteDays: 3, dayDays: 10 } })

    await monitor.modules.instances.keep(id)

    const days = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=30d&bucket=1d`)
    const day = (at: Date) => new Date(Math.floor(at.getTime() / DAY) * DAY).toISOString()
    // Eight and five days ago from their summary, the minutes of them gone; twenty days ago forgotten altogether.
    expect(days.points.filter(point => point.max !== null).map(point => [point.at, point.min, point.max]))
      .toEqual([[day(ago(8 * DAY)), 1, 1], [day(ago(5 * DAY)), 1, 2], [day(ago(5 * MINUTE)), 1, 1]])
    const minutes = await json<InstanceCountSeriesDTO>(`/api/apps/${id}/instances/count?window=7d&bucket=1h`)
    expect(minutes.points.filter(point => point.max !== null)).toHaveLength(1)
    // `c` stopped eight days ago and `b` was lost five days ago: forgotten. `a` was heard of five minutes ago.
    expect((await json<InstancesDTO>(`/api/apps/${id}/instances`)).instances.map(each => each.instanceId)).toEqual(['a'])
  })

  test('forgets everything of an application deleted', async () => {
    sampled('a', ago(20 * MINUTE), [0])
    await collect()
    await monitor.modules.instances.forget(id)
    expect(await monitor.modules.instances.list(id)).toEqual({ system: null, instances: [] })
  })
})
