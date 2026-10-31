import type { DuckDbAnalytics, DuckDbParam } from 'newt/adapter-duckdb'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../../event-metrics/event-metrics.schema'
import type { InstanceCountSeriesDTO, ServerPointDTO, ServerSeriesDTO } from '../instances.schema'

const DAY_MS = 24 * 60 * 60_000

/** How far back a disk's pace is measured, to say when it fills. */
const PACE_MS = 7 * DAY_MS

/** The least time a disk's pace is measured over: less says nothing yet. */
const LEAST_PACE_MS = 60 * 60_000

const floor = (ms: number, size: number) => ms - (ms % size)

/** One table's rows read by bucket: from the minutes, or from the days and the minutes after them. */
type Reading = { table: string, time: string, from: number, to: number }

/**
 * What a panel reads of an application's servers and instances, in DuckDB's SQL,
 * grouped by bucket as it is read. Days older than the summary's newest come from it,
 * the rest from the minutes.
 */
export class InstancesQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  /** How many instances were alive in each bucket of a window: at the emptiest and the fullest. */
  async count(window: MetricsWindow, bucket: MetricsBucket, now: Date): Promise<InstanceCountSeriesDTO> {
    const { from, to, size } = this.span(window, bucket, now)
    const found = new Map<number, { min: number, max: number }>()
    for (const reading of await this.readings('instance_count', from, to, size)) {
      for (const row of await this.analytics.query<{ slot: number, min: number, max: number }>(
        `SELECT ${this.slot(reading.time, size)} AS slot, min(min) AS min, max(max) AS max FROM ${reading.table}
         WHERE ${reading.time} >= CAST($1 AS TIMESTAMP) AND ${reading.time} < CAST($2 AS TIMESTAMP) GROUP BY slot`,
        [new Date(reading.from).toISOString(), new Date(reading.to).toISOString()])) {
        found.set(row.slot * 1000, { min: row.min, max: row.max })
      }
    }
    const points = []
    for (let at = from; at < to; at += size) points.push({ at: new Date(at).toISOString(), min: found.get(at)?.min ?? null, max: found.get(at)?.max ?? null })
    return { window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(), points }
  }

  /** A server in each bucket of a window: its memory, its processors and each disk. */
  async server(server: string, window: MetricsWindow, bucket: MetricsBucket, now: Date): Promise<ServerSeriesDTO> {
    const { from, to, size } = this.span(window, bucket, now)
    const points = new Map<number, ServerPointDTO>()
    const pointAt = (at: number) => {
      if (!points.has(at)) points.set(at, { at: new Date(at).toISOString(), memoryTotalBytes: null, memoryFreeBytes: null, cpuUsage: null, cpuUsageMax: null, load: null, disks: {} })
      return points.get(at)!
    }
    const range = (reading: Reading): DuckDbParam[] => [new Date(reading.from).toISOString(), new Date(reading.to).toISOString(), server]
    const where = (time: string) => `${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($2 AS TIMESTAMP) AND server = $3`
    for (const reading of await this.readings('server', from, to, size)) {
      for (const row of await this.analytics.query<{ slot: number, memory_total: number, memory_free: number, usage: number | null, usage_max: number | null, load: number }>(
        `SELECT ${this.slot(reading.time, size)} AS slot, max(memory_total) AS memory_total, min(memory_free_min) AS memory_free,
           avg(usage_mean) AS usage, max(usage_max) AS usage_max, max(load_max) AS load
         FROM ${reading.table} WHERE ${where(reading.time)} GROUP BY slot`, range(reading))) {
        Object.assign(pointAt(row.slot * 1000), { memoryTotalBytes: row.memory_total, memoryFreeBytes: row.memory_free, cpuUsage: row.usage, cpuUsageMax: row.usage_max, load: row.load })
      }
    }
    for (const reading of await this.readings('disk', from, to, size)) {
      for (const row of await this.analytics.query<{ slot: number, path: string, free: number }>(
        `SELECT ${this.slot(reading.time, size)} AS slot, path, min(free_min) AS free FROM ${reading.table} WHERE ${where(reading.time)} GROUP BY slot, path`, range(reading))) {
        pointAt(row.slot * 1000).disks[row.path] = row.free
      }
    }
    const disks = Object.fromEntries((await this.analytics.query<{ path: string, total: number }>(
      `SELECT path, arg_max(total, minute) AS total FROM disk_minute WHERE server = $1 GROUP BY path ORDER BY path`, [server])).map(row => [row.path, row.total]))
    const all: ServerPointDTO[] = []
    for (let at = from; at < to; at += size) {
      const point = pointAt(at)
      for (const path of Object.keys(disks)) point.disks[path] ??= null
      all.push(point)
    }
    return { server, window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(), disks, points: all }
  }

  /**
   * In how many days each disk of each server fills at the pace it lost free space over
   * the last week (or since it was first read, an hour at least): null for one that does
   * not lose any, or read too briefly. Keyed `<server>|<path>`.
   */
  async fullInDays(now: Date): Promise<Map<string, number | null>> {
    const since = new Date(now.getTime() - PACE_MS).toISOString()
    const rows = await this.analytics.query<{ server: string, path: string, first_at: string, first_free: number, last_at: string, last_free: number }>(`
      SELECT server, path, min(minute) AS first_at, arg_min(free_mean, minute) AS first_free, max(minute) AS last_at, arg_max(free_mean, minute) AS last_free
      FROM disk_minute WHERE minute >= CAST($1 AS TIMESTAMP) GROUP BY server, path`, [since])
    return new Map(rows.map(row => {
      const span = Date.parse(row.last_at) - Date.parse(row.first_at)
      const lost = row.first_free - row.last_free
      const days = span < LEAST_PACE_MS || lost <= 0 ? null : row.last_free / (lost / (span / DAY_MS))
      return [`${row.server}|${row.path}`, days]
    }))
  }

  private span(window: MetricsWindow, bucket: MetricsBucket, now: Date) {
    const size = BUCKETS[bucket]
    const to = floor(now.getTime(), size) + size
    return { from: to - WINDOWS[window].ms, to, size }
  }

  private slot(time: string, size: number): string {
    const seconds = size / 1000
    return `CAST(floor(epoch(CAST(${time} AS TIMESTAMP)) / ${seconds}) * ${seconds} AS BIGINT)`
  }

  /** Where a window's buckets are read from: by day, the whole days the summary has and the minutes after them. */
  private async readings(name: string, from: number, to: number, size: number): Promise<Reading[]> {
    if (size !== BUCKETS['1d']) return [{ table: `${name}_minute`, time: 'minute', from, to }]
    const [row] = await this.analytics.query<{ until: string | null }>(`SELECT max(day) + INTERVAL 1 DAY AS until FROM ${name}_day`)
    const split = Math.min(Math.max(row?.until ? Date.parse(row.until) : 0, from), to)
    return [{ table: `${name}_day`, time: 'day', from, to: split }, { table: `${name}_minute`, time: 'minute', from: split, to }]
      .filter(reading => reading.to > reading.from)
  }
}
