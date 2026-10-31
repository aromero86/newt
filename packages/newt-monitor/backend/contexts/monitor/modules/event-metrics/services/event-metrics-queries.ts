import type { DuckDbAnalytics, DuckDbParam } from 'newt/adapter-duckdb'
import { spansOf } from '../../../../../shared/metrics-store/metrics-spans'
import { whereOf as sharedWhereOf, type MetricsFilter } from '../../../../../shared/metrics-store/metrics-filter'
import { BUCKETS, WINDOWS, type EventTotalDTO, type MetricsBucket, type MetricsWindow, type SeriesDTO, type SeriesPointDTO, type TopDTO } from '../event-metrics.schema'

type Filter = { context: string, event: string, scope?: string, actor?: string }

/** A filter of events, as the shared one says it. */
const asShared = (filter: Filter): MetricsFilter => ({ context: filter.context, name: filter.event, scope: filter.scope, actor: filter.actor })

const floor = (ms: number, size: number) => ms - (ms % size)

const whereOf = (filter: Filter, first: number, withActor: boolean) => sharedWhereOf(asShared(filter), 'event', first, withActor)

/**
 * What a panel reads of an application's metrics, in DuckDB's SQL: each bucket summed
 * as it is read. Days older than the summary's newest come from it; the rest, and
 * anything filtered by actor (which the summary has not), from the minutes.
 */
export class EventMetricsQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  async series(filter: Filter, window: MetricsWindow, bucket: MetricsBucket, compare: 'previous' | 'week' | 'none', now: Date): Promise<SeriesDTO> {
    const size = BUCKETS[bucket]
    const length = WINDOWS[window].ms
    const to = floor(now.getTime(), size) + size
    const from = to - length
    const points = await this.points(filter, from, to, size)
    const shift = compare === 'week' ? 7 * 24 * 60 * 60_000 : length
    const compared = compare === 'none' ? null : (await this.points(filter, from - shift, to - shift, size)).map(point => ({ at: new Date(Date.parse(point.at) + shift).toISOString(), count: point.count }))
    const sum = (each: SeriesPointDTO[]) => each.reduce((total, point) => total + point.count, 0)
    return {
      window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      points, total: sum(points), compared, comparedTotal: compared ? sum(compared) : null,
    }
  }

  /** Each event's total in the window, and in the one just before: whole days older than the minutes from the summary. */
  async totals(window: MetricsWindow, now: Date): Promise<EventTotalDTO[]> {
    const length = WINDOWS[window].ms
    const to = now.getTime()
    const totals = new Map<string, EventTotalDTO>()
    for (const span of spansOf(to - 2 * length, to, await this.summarizedUntil())) {
      const [table, time] = span.table === 'day' ? ['event_day', 'day'] : ['event_minute', 'minute']
      for (const row of await this.analytics.query<{ context: string, event: string, recent: boolean, count: number }>(`
        SELECT context, event, CAST(${time} AS TIMESTAMP) >= CAST($2 AS TIMESTAMP) AS recent, sum(count) AS count
        FROM ${table} WHERE ${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($3 AS TIMESTAMP)
        GROUP BY context, event, recent`,
      [new Date(span.start).toISOString(), new Date(to - length).toISOString(), new Date(span.end).toISOString()])) {
        const key = JSON.stringify([row.context, row.event])
        const total = totals.get(key) ?? { context: row.context, event: row.event, total: 0, previous: 0 }
        total[row.recent ? 'total' : 'previous'] += row.count
        totals.set(key, total)
      }
    }
    return [...totals.values()].sort((a, b) => b.total - a.total || a.context.localeCompare(b.context) || a.event.localeCompare(b.event))
  }

  /** Who told it most in the window: the ten first, by actor or by a scope's id. */
  async top(filter: Filter, window: MetricsWindow, by: string, now: Date): Promise<TopDTO[]> {
    const where = whereOf(filter, 3, true)
    const value = by === 'actor' ? 'actor' : `json_extract_string(scopes, $${3 + where.params.length})`
    const params: DuckDbParam[] = [new Date(now.getTime() - WINDOWS[window].ms).toISOString(), now.toISOString(), ...where.params]
    if (by !== 'actor') params.push(`$."${by.slice('scope:'.length)}"`)
    return this.analytics.query<TopDTO>(`
      SELECT ${value} AS value, sum(count) AS count FROM event_minute
      WHERE minute >= $1 AND minute < $2 AND ${where.sql}
      GROUP BY value ORDER BY count DESC, value LIMIT 10`, params)
  }

  /** The names of the scopes it was told in, in the window. */
  async scopeNames(filter: Filter, window: MetricsWindow, now: Date): Promise<string[]> {
    const where = whereOf(filter, 3, false)
    const rows = await this.analytics.query<{ name: string }>(`
      SELECT DISTINCT unnest(json_keys(scopes)) AS name FROM event_minute
      WHERE minute >= $1 AND minute < $2 AND ${where.sql} ORDER BY name`,
    [new Date(now.getTime() - WINDOWS[window].ms).toISOString(), now.toISOString(), ...where.params])
    return rows.map(row => row.name)
  }

  /** Every bucket from `from` to `to`, those with nothing at zero. */
  private async points(filter: Filter, from: number, to: number, size: number): Promise<SeriesPointDTO[]> {
    const seconds = size / 1000
    const fromDays = size === BUCKETS['1d'] && filter.actor === undefined ? await this.summarizedUntil() : null
    const counts = new Map<number, number>()
    const read = async (table: 'event_minute' | 'event_day', time: string, start: number, end: number) => {
      if (end <= start) return
      const where = whereOf(filter, 3, table === 'event_minute')
      const rows = await this.analytics.query<{ bucket: number, count: number }>(`
        SELECT CAST(floor(epoch(CAST(${time} AS TIMESTAMP)) / ${seconds}) * ${seconds} AS BIGINT) AS bucket, sum(count) AS count
        FROM ${table} WHERE ${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($2 AS TIMESTAMP) AND ${where.sql}
        GROUP BY bucket`, [new Date(start).toISOString(), new Date(end).toISOString(), ...where.params])
      for (const row of rows) counts.set(row.bucket * 1000, (counts.get(row.bucket * 1000) ?? 0) + row.count)
    }
    if (fromDays !== null) {
      // Whole days the summary has, then the minutes after them.
      const split = Math.min(Math.max(fromDays, from), to)
      await read('event_day', 'day', from, split)
      await read('event_minute', 'minute', split, to)
    } else {
      await read('event_minute', 'minute', from, to)
    }
    const points: SeriesPointDTO[] = []
    for (let at = from; at < to; at += size) points.push({ at: new Date(at).toISOString(), count: counts.get(at) ?? 0 })
    return points
  }

  /** The end of the newest day summed, as epoch ms: the minutes take over from it. */
  private async summarizedUntil(): Promise<number> {
    const [row] = await this.analytics.query<{ until: string | null }>(`SELECT max(day) + INTERVAL 1 DAY AS until FROM event_day`)
    return row?.until ? Date.parse(row.until) : 0
  }
}
