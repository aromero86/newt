import { Module, now, UseCase } from 'newt/core'
import type { InstanceMinute } from 'newt/runtime'
import type { MonitorBase } from '../../../../monitor-base'
import { DEFAULT_BUCKET } from '../event-metrics/event-metrics.schema'
import { Instance, InstanceCountQuerySchema, InstancesFeed, ServerSeriesQuerySchema, type CollectInstancesDTO, type InstanceCountSeriesDTO, type InstancesDTO, type ServerDTO, type ServerSeriesDTO } from './instances'
import type { Instances_Deps } from './instances.deps'
import type { Instances_Options } from './instances-options'
import { Instance_Repository, InstancesFeed_Repository } from './instances.repository'
import { registerInstancesRoutes } from './instances.routes'
import { registerInstancesWorkers } from './instances.workers'
import { InstancesQueries } from './services/instances-queries'

const DAY_MS = 24 * 60 * 60_000

/** How long an instance that stopped, or was lost, is still listed. */
const GONE_KEPT_DAYS = 7

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/** The 10-second slots of a minute. */
const SLOTS = [0, 1, 2, 3, 4, 5]

/**
 * Each application's instances and the servers they run on: every instance as it is
 * now (alive, stopped or lost), and minute by minute how many were alive and how each
 * server's disks, memory and processors went. Collected every minute, the minutes into
 * its DuckDB, summed by day, forgotten as its retention says; an instance gone for a
 * week is forgotten too.
 */
export class Instances_Module extends Module {

  static initialize(base: MonitorBase, deps: Instances_Deps, options: Instances_Options): Instances_Module {
    const server = { memory_total: 'BIGINT', memory_free_mean: 'DOUBLE', memory_free_min: 'BIGINT', cores: 'INTEGER', load_mean: 'DOUBLE', load_max: 'DOUBLE', usage_mean: 'DOUBLE', usage_max: 'DOUBLE' } as const
    const disk = { total: 'BIGINT', free_mean: 'DOUBLE', free_min: 'BIGINT' } as const
    options.store.define({
      instance_count_minute: { columns: { minute: 'TIMESTAMP', min: 'INTEGER', max: 'INTEGER' } },
      instance_count_day: { columns: { day: 'DATE', min: 'INTEGER', max: 'INTEGER' } },
      server_minute: { columns: { minute: 'TIMESTAMP', server: 'VARCHAR', ...server } },
      server_day: { columns: { day: 'DATE', server: 'VARCHAR', ...server } },
      disk_minute: { columns: { minute: 'TIMESTAMP', server: 'VARCHAR', path: 'VARCHAR', ...disk } },
      disk_day: { columns: { day: 'DATE', server: 'VARCHAR', path: 'VARCHAR', ...disk } },
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

  /** Sums each whole day at least a day old, forgets what its retention says is old, and the instances gone for a week. */
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
      INSERT INTO server_day (id, day, server, memory_total, memory_free_mean, memory_free_min, cores, load_mean, load_max, usage_mean, usage_max)
      SELECT ${dayId} || '|' || server, ${day}, server, max(memory_total), avg(memory_free_mean), min(memory_free_min), max(cores), avg(load_mean), max(load_max), avg(usage_mean), max(usage_max)
      FROM server_minute WHERE minute < CAST($1 AS DATE) GROUP BY ${day}, server
      ON CONFLICT DO NOTHING`, before)
    await analytics.run(`
      INSERT INTO disk_day (id, day, server, path, total, free_mean, free_min)
      SELECT ${dayId} || '|' || server || '|' || path, ${day}, server, path, max(total), avg(free_mean), min(free_min)
      FROM disk_minute WHERE minute < CAST($1 AS DATE) GROUP BY ${day}, server, path
      ON CONFLICT DO NOTHING`, before)
    const minutesBefore = new Date(at.getTime() - resourceMinuteDays * DAY_MS).toISOString()
    for (const table of ['instance_count_minute', 'server_minute', 'disk_minute']) await analytics.run(`DELETE FROM ${table} WHERE minute < CAST($1 AS TIMESTAMP)`, [minutesBefore])
    if (dayDays !== null) {
      for (const table of ['instance_count_day', 'server_day', 'disk_day']) await analytics.run(`DELETE FROM ${table} WHERE day < CAST($1 AS DATE)`, [dayBefore(at, dayDays)])
    }
    const forgottenBefore = new Date(at.getTime() - GONE_KEPT_DAYS * DAY_MS).toISOString()
    const gone = (await this.repo.find({ appId })).filter(instance => {
      const since = instance.goneSince(at)
      return since !== null && since < forgottenBefore
    })
    await this.repo.purgeGone(appId, gone.map(instance => instance.id))
  }

  /** Keeps every application's servers and instances, archived ones too: their retention runs all the same. */
  @UseCase()
  async keepAll(): Promise<void> {
    for (const feed of await this.feeds.find({})) await this.keep(feed.appId)
  }

  /** Its servers and instances as they are now: each server by the last of its instances heard of. */
  @UseCase()
  async list(appId: string): Promise<InstancesDTO> {
    await this.deps.app.get(appId)
    const at = now()
    const instances = (await this.repo.find({ appId })).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    const fullIn = await (await this.queries(appId)).fullInDays(at)
    const servers = new Map<string, ServerDTO>()
    for (const instance of instances) {
      const alive = instance.statusAt(at) === 'alive' ? 1 : 0
      const server = servers.get(instance.server)
      if (server) {
        server.instances.alive += alive
        server.instances.total++
        continue
      }
      // The newest first: the server as its last instance read it.
      const { name, disks, memory, cpu } = instance.reading
      servers.set(name, {
        name, at: instance.lastSeenAt, memory, cpu,
        disks: disks.map(disk => ({ ...disk, fullInDays: fullIn.get(`${name}|${disk.path}`) ?? null })),
        instances: { alive, total: 1 },
      })
    }
    const order = { alive: 0, lost: 1, stopped: 2 }
    const views = instances.map(instance => instance.view(at)).sort((a, b) => order[a.status] - order[b.status] || b.lastSeenAt.localeCompare(a.lastSeenAt))
    return { servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)), instances: views }
  }

  /** How many instances were alive over a window, by bucket. */
  @UseCase()
  async count(appId: string, input: unknown): Promise<InstanceCountSeriesDTO> {
    await this.deps.app.get(appId)
    const query = InstanceCountQuerySchema.parse(input)
    return (await this.queries(appId)).count(query.window, query.bucket ?? DEFAULT_BUCKET[query.window], now())
  }

  /** A server over a window, by bucket: its memory, its processors and its disks. */
  @UseCase()
  async server(appId: string, input: unknown): Promise<ServerSeriesDTO> {
    await this.deps.app.get(appId)
    const query = ServerSeriesQuerySchema.parse(input)
    return (await this.queries(appId)).server(query.server, query.window, query.bucket ?? DEFAULT_BUCKET[query.window], now())
  }

  /** Forgets everything of an application deleted: its feed, its instances and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.feeds.purgeApp(appId)
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.of(appId)
    for (const table of ['instance_count_minute', 'instance_count_day', 'server_minute', 'server_day', 'disk_minute', 'disk_day']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  /**
   * The minutes collected, into its DuckDB: how many instances were alive at each
   * 10-second slot, at the emptiest and the fullest (an instance counts from its first
   * slot of the minute to its last), and each server and disk once, as its first
   * instance read it.
   */
  private async append(appId: string, minutes: InstanceMinute[]): Promise<void> {
    if (minutes.length === 0) return
    const analytics = await this.options.store.of(appId)
    const byMinute = new Map<string, InstanceMinute[]>()
    for (const each of minutes) byMinute.set(each.minute, [...byMinute.get(each.minute) ?? [], each])
    const counts = [...byMinute].map(([minute, instances]) => {
      const alive = SLOTS.map(slot => instances.filter(each => each.slots.length > 0 && Math.min(...each.slots) <= slot && slot <= Math.max(...each.slots)).length)
      return { id: minute, minute, min: Math.min(...alive), max: Math.max(...alive) }
    })
    const servers = new Map<string, InstanceMinute>()
    for (const each of minutes) if (!servers.has(`${each.minute}|${each.server.name}`)) servers.set(`${each.minute}|${each.server.name}`, each)
    await analytics.append('instance_count_minute', counts)
    await analytics.append('server_minute', [...servers].map(([id, { minute, server }]) => ({
      id, minute, server: server.name,
      memory_total: server.memory.totalBytes, memory_free_mean: server.memory.freeBytes.mean, memory_free_min: server.memory.freeBytes.min,
      cores: server.cpu.cores, load_mean: server.cpu.load.mean, load_max: server.cpu.load.max,
      usage_mean: server.cpu.usage?.mean ?? null, usage_max: server.cpu.usage?.max ?? null,
    })))
    await analytics.append('disk_minute', [...servers].flatMap(([id, { minute, server }]) => server.disks.map(disk => ({
      id: `${id}|${disk.path}`, minute, server: server.name, path: disk.path,
      total: disk.totalBytes, free_mean: disk.freeBytes.mean, free_min: disk.freeBytes.min,
    }))))
  }

  private async queries(appId: string): Promise<InstancesQueries> {
    return new InstancesQueries(await this.options.store.of(appId))
  }
}
