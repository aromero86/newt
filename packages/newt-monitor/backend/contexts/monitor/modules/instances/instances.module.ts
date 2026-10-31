import { Module, now, UseCase } from 'newt/core'
import type { InstanceMinute } from 'newt/runtime'
import type { MonitorBase } from '../../../../monitor-base'
import { DEFAULT_BUCKET } from '../event-metrics/event-metrics.schema'
import { Instance, InstanceCountQuerySchema, InstancesFeed, SystemSeriesQuerySchema, type CollectInstancesDTO, type InstanceCountSeriesDTO, type InstancesDTO, type SystemDTO, type SystemSeriesDTO } from './instances'
import type { Instances_Deps } from './instances.deps'
import type { Instances_Options } from './instances-options'
import { Instance_Repository, InstancesFeed_Repository } from './instances.repository'
import { registerInstancesRoutes } from './instances.routes'
import { registerInstancesWorkers } from './instances.workers'
import { InstancesQueries } from './services/instances-queries'

const DAY_MS = 24 * 60 * 60_000

/** How long an instance that stopped, or was lost, is still listed: a deployment's, the day after. */
const GONE_KEPT_DAYS = 1

/** The columns the system is kept by, minute by minute and day by day: the application's processes, and the machines they ran on. */
const SYSTEM = {
  rss_mean: 'DOUBLE', rss_max: 'DOUBLE', heap_mean: 'DOUBLE', cpu_mean: 'DOUBLE', cpu_max: 'DOUBLE', loop_max: 'DOUBLE',
  memory_total: 'BIGINT', memory_free_mean: 'DOUBLE', memory_free_min: 'BIGINT', cores: 'INTEGER',
  load_mean: 'DOUBLE', load_max: 'DOUBLE', usage_mean: 'DOUBLE', usage_max: 'DOUBLE',
} as const
const DISK = { path: 'VARCHAR', total: 'BIGINT', free_mean: 'DOUBLE', free_min: 'BIGINT' } as const

/** How a day sums its minutes, column by column. */
const SYSTEM_DAY = 'avg(rss_mean), max(rss_max), avg(heap_mean), avg(cpu_mean), max(cpu_max), max(loop_max), max(memory_total), avg(memory_free_mean), min(memory_free_min), max(cores), avg(load_mean), max(load_max), avg(usage_mean), max(usage_max)'

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/** The 10-second slots of a minute. */
const SLOTS = [0, 1, 2, 3, 4, 5]

/**
 * Each application's instances and the system they make: every instance as it is now
 * (alive, stopped or lost), and minute by minute how many were alive, how much memory
 * and processor the application took, and how the machines it ran on went, whichever
 * they were: a deployment's new instances and machines go on the same lines. Collected
 * every minute, the minutes into its DuckDB, summed by day, forgotten as its retention
 * says; an instance gone for a day is forgotten too.
 */
export class Instances_Module extends Module {

  static initialize(base: MonitorBase, deps: Instances_Deps, options: Instances_Options): Instances_Module {
    options.store.define({
      instance_count_minute: { columns: { minute: 'TIMESTAMP', min: 'INTEGER', max: 'INTEGER' } },
      instance_count_day: { columns: { day: 'DATE', min: 'INTEGER', max: 'INTEGER' } },
      system_minute: { columns: { minute: 'TIMESTAMP', ...SYSTEM } },
      system_day: { columns: { day: 'DATE', ...SYSTEM } },
      system_disk_minute: { columns: { minute: 'TIMESTAMP', ...DISK } },
      system_disk_day: { columns: { day: 'DATE', ...DISK } },
    })
    const module = new Instances_Module(base, new InstancesFeed_Repository(base), new Instance_Repository(base), deps, options)
    registerInstancesRoutes(base, module)
    registerInstancesWorkers(module, deps)
    return module
  }

  /** Every minute: each application's instances now, and the minutes closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(
    base: MonitorBase,
    private readonly feeds: InstancesFeed_Repository,
    private readonly repo: Instance_Repository,
    private readonly deps: Instances_Deps,
    private readonly options: Instances_Options,
  ) {
    super('instances', base.invocations, deps)
    this.minutely = base.schedules.define('instances.minutely', '* * * * *')
    this.nightly = base.schedules.define('instances.nightly', '50 3 * * *')
  }

  /** Asks the application for its instances now and their minutes closed since the last collection, and keeps them. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectInstancesDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.feeds.first({ appId }) ?? InstancesFeed.start(appId)
    const read = await this.deps.connection.fetchInstances(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    const known = new Map((await this.repo.find({ appId })).map(instance => [instance.instanceId, instance]))
    const heard = read.value.instances.map(state => {
      const instance = known.get(state.instance)
      if (!instance) return Instance.heard(appId, state)
      instance.heardAgain(state)
      return instance
    })
    if (heard.length > 0) await this.repo.persist(...heard)
    await this.append(appId, read.value.minutes)
    feed.collectedUntil(read.value.until)
    await this.feeds.persist(feed)
    return { appId, outcome: 'collected', instances: heard.length, minutes: read.value.minutes.length, until: read.value.until }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectInstancesDTO[]> {
    const collected: CollectInstancesDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) collected.push(await this.collect(appId))
    return collected
  }

  /** Sums each whole day at least a day old, forgets what its retention says is old, and the instances gone for a day. */
  @UseCase()
  async keep(appId: string): Promise<void> {
    const at = now()
    const { resourceMinuteDays, dayDays } = await this.deps.retention.of(appId)
    const analytics = await this.options.store.of(appId)
    const before = [dayBefore(at, 1)]
    const day = 'CAST(minute AS DATE)'
    const dayId = `strftime(${day}, '%Y-%m-%d')`
    await analytics.run(`
      INSERT INTO instance_count_day (id, day, min, max)
      SELECT ${dayId}, ${day}, min(min), max(max) FROM instance_count_minute WHERE minute < CAST($1 AS DATE) GROUP BY ${day}
      ON CONFLICT DO NOTHING`, before)
    await analytics.run(`
      INSERT INTO system_day (id, day, ${Object.keys(SYSTEM).join(', ')})
      SELECT ${dayId}, ${day}, ${SYSTEM_DAY} FROM system_minute WHERE minute < CAST($1 AS DATE) GROUP BY ${day}
      ON CONFLICT DO NOTHING`, before)
    await analytics.run(`
      INSERT INTO system_disk_day (id, day, path, total, free_mean, free_min)
      SELECT ${dayId} || '|' || path, ${day}, path, max(total), avg(free_mean), min(free_min)
      FROM system_disk_minute WHERE minute < CAST($1 AS DATE) GROUP BY ${day}, path
      ON CONFLICT DO NOTHING`, before)
    const minutesBefore = new Date(at.getTime() - resourceMinuteDays * DAY_MS).toISOString()
    for (const table of ['instance_count_minute', 'system_minute', 'system_disk_minute']) await analytics.run(`DELETE FROM ${table} WHERE minute < CAST($1 AS TIMESTAMP)`, [minutesBefore])
    if (dayDays !== null) {
      for (const table of ['instance_count_day', 'system_day', 'system_disk_day']) await analytics.run(`DELETE FROM ${table} WHERE day < CAST($1 AS DATE)`, [dayBefore(at, dayDays)])
    }
    const forgottenBefore = new Date(at.getTime() - GONE_KEPT_DAYS * DAY_MS).toISOString()
    const gone = (await this.repo.find({ appId })).filter(instance => {
      const since = instance.goneSince(at)
      return since !== null && since < forgottenBefore
    })
    await this.repo.purgeGone(appId, gone.map(instance => instance.id))
  }

  /** Keeps every application's system and instances, archived ones too: their retention runs all the same. */
  @UseCase()
  async keepAll(): Promise<void> {
    for (const feed of await this.feeds.find({})) await this.keep(feed.appId)
  }

  /** Its system as its instances alive read it now, and its instances: those alive, then those gone in the last day. */
  @UseCase()
  async list(appId: string): Promise<InstancesDTO> {
    await this.deps.app.get(appId)
    const at = now()
    const instances = await this.repo.find({ appId })
    const alive = instances.filter(instance => instance.statusAt(at) === 'alive')
    const order = { alive: 0, lost: 1, stopped: 2 }
    const views = instances.map(instance => instance.view(at)).sort((a, b) => order[a.status] - order[b.status] || b.lastSeenAt.localeCompare(a.lastSeenAt))
    return { system: alive.length > 0 ? this.systemOf(alive, await (await this.queries(appId)).fullInDays(at)) : null, instances: views }
  }

  /** How many instances were alive over a window, by bucket. */
  @UseCase()
  async count(appId: string, input: unknown): Promise<InstanceCountSeriesDTO> {
    await this.deps.app.get(appId)
    const query = InstanceCountQuerySchema.parse(input)
    return (await this.queries(appId)).count(query.window, query.bucket ?? DEFAULT_BUCKET[query.window], now())
  }

  /** The system over a window, by bucket: the application's memory, processor and event loop, and its machines' memory, processors and disks. */
  @UseCase()
  async system(appId: string, input: unknown): Promise<SystemSeriesDTO> {
    await this.deps.app.get(appId)
    const query = SystemSeriesQuerySchema.parse(input)
    return (await this.queries(appId)).system(query.window, query.bucket ?? DEFAULT_BUCKET[query.window], now())
  }

  /** Forgets everything of an application deleted: its feed, its instances and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.feeds.purgeApp(appId)
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.of(appId)
    for (const table of ['instance_count_minute', 'instance_count_day', 'system_minute', 'system_day', 'system_disk_minute', 'system_disk_day']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  /**
   * The minutes collected, into its DuckDB, each one whatever instances and machines it
   * had: how many instances were alive at each 10-second slot, at the emptiest and the
   * fullest (an instance counts from its first slot of the minute to its last); the
   * application's processes added up and its worst event loop; and its machines at
   * their fullest, each disk by its path.
   */
  private async append(appId: string, minutes: InstanceMinute[]): Promise<void> {
    if (minutes.length === 0) return
    const analytics = await this.options.store.of(appId)
    const byMinute = new Map<string, InstanceMinute[]>()
    for (const each of minutes) byMinute.set(each.minute, [...byMinute.get(each.minute) ?? [], each])
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
    const counts = [...byMinute].map(([minute, instances]) => {
      const alive = SLOTS.map(slot => instances.filter(each => each.slots.length > 0 && Math.min(...each.slots) <= slot && slot <= Math.max(...each.slots)).length)
      return { id: minute, minute, min: Math.min(...alive), max: Math.max(...alive) }
    })
    const systems = [...byMinute].map(([minute, instances]) => {
      const usages = instances.flatMap(each => (each.server.cpu.usage ? [each.server.cpu.usage] : []))
      // The machine with the least memory free, its total with it.
      const fullest = instances.reduce((least, each) => (each.server.memory.freeBytes.mean < least.server.memory.freeBytes.mean ? each : least))
      return {
        id: minute, minute,
        rss_mean: sum(instances.map(each => each.process.rssBytes.mean)), rss_max: sum(instances.map(each => each.process.rssBytes.max)),
        heap_mean: sum(instances.map(each => each.process.heapUsedBytes.mean)),
        cpu_mean: sum(instances.map(each => each.process.cpu.mean)), cpu_max: sum(instances.map(each => each.process.cpu.max)),
        loop_max: Math.max(...instances.map(each => each.process.loopMaxMs)),
        memory_total: fullest.server.memory.totalBytes, memory_free_mean: fullest.server.memory.freeBytes.mean,
        memory_free_min: Math.min(...instances.map(each => each.server.memory.freeBytes.min)),
        cores: Math.max(...instances.map(each => each.server.cpu.cores)),
        load_mean: Math.max(...instances.map(each => each.server.cpu.load.mean)), load_max: Math.max(...instances.map(each => each.server.cpu.load.max)),
        usage_mean: usages.length ? Math.max(...usages.map(usage => usage.mean)) : null, usage_max: usages.length ? Math.max(...usages.map(usage => usage.max)) : null,
      }
    })
    const disks = [...byMinute].flatMap(([minute, instances]) => {
      const paths = new Map<string, { total: number, freeMean: number, freeMin: number }>()
      for (const disk of instances.flatMap(each => each.server.disks)) {
        const seen = paths.get(disk.path)
        paths.set(disk.path, seen
          ? { total: Math.max(seen.total, disk.totalBytes), freeMean: Math.min(seen.freeMean, disk.freeBytes.mean), freeMin: Math.min(seen.freeMin, disk.freeBytes.min) }
          : { total: disk.totalBytes, freeMean: disk.freeBytes.mean, freeMin: disk.freeBytes.min })
      }
      return [...paths].map(([path, disk]) => ({ id: `${minute}|${path}`, minute, path, total: disk.total, free_mean: disk.freeMean, free_min: disk.freeMin }))
    })
    await analytics.append('instance_count_minute', counts)
    await analytics.append('system_minute', systems)
    await analytics.append('system_disk_minute', disks)
  }

  /** The system now, from the last reading of each instance alive: the processes added up, the machines at their fullest. */
  private systemOf(alive: Instance[], fullIn: Map<string, number | null>): SystemDTO {
    const readings = alive.map(instance => instance.reading)
    const fullest = readings.reduce((least, each) => (each.memory.freeBytes < least.memory.freeBytes ? each : least))
    const usages = readings.flatMap(each => (each.cpu.usage === null ? [] : [each.cpu.usage]))
    const disks = new Map<string, { path: string, totalBytes: number, freeBytes: number }>()
    for (const disk of readings.flatMap(each => each.disks)) {
      const seen = disks.get(disk.path)
      if (!seen || disk.freeBytes < seen.freeBytes) disks.set(disk.path, disk)
    }
    return {
      at: alive.map(instance => instance.lastSeenAt).sort().at(-1)!,
      instances: alive.length,
      process: {
        rssBytes: alive.reduce((total, instance) => total + instance.process.rssBytes, 0),
        heapUsedBytes: alive.reduce((total, instance) => total + instance.process.heapUsedBytes, 0),
        cpu: alive.reduce((total, instance) => total + instance.process.cpu, 0),
        loopMaxMs: Math.max(...alive.map(instance => instance.process.loopMaxMs)),
      },
      memory: fullest.memory,
      cpu: { cores: Math.max(...readings.map(each => each.cpu.cores)), usage: usages.length ? Math.max(...usages) : null, load: Math.max(...readings.map(each => each.cpu.load[0])) },
      disks: [...disks.values()].sort((a, b) => a.path.localeCompare(b.path)).map(disk => ({ ...disk, fullInDays: fullIn.get(disk.path) ?? null })),
    }
  }

  private async queries(appId: string): Promise<InstancesQueries> {
    return new InstancesQueries(await this.options.store.of(appId))
  }
}
