import type { DuckDbAnalytics, DuckDbParam } from '@newt-kit/newt/adapter-duckdb'
import { spansOf } from '../../../../../shared/metrics-store/metrics-spans'
import { whereOf, type MetricsFilter } from '../../../../../shared/metrics-store/metrics-filter'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../../event-metrics/event-metrics.schema'
import type { EndedDTO, EndedPointDTO, ErrorCodeDTO, ErrorsSeriesDTO, ErrorsTopDTO, ErrorsTotalDTO } from '../use-case-errors.schema'

type Kind = 'error' | 'failure'
const field = (kind: Kind) => (kind === 'error' ? 'errors' : 'failures')
const none = (): EndedDTO => ({ errors: 0, failures: 0 })
const floor = (ms: number, size: number) => ms - (ms % size)

/**
 * What a panel reads of how an application's use case calls ended, in DuckDB's SQL:
 * errors and failures summed by bucket, code, actor or scope as they are read. Days
 * older than the summary's newest come from it; the rest, and anything filtered by
 * actor, from the minutes.
 */
export class UseCaseErrorsQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  async series(filter: MetricsFilter, window: MetricsWindow, bucket: MetricsBucket, now: Date): Promise<ErrorsSeriesDTO> {
    const size = BUCKETS[bucket]
    const seconds = size / 1000
    const to = floor(now.getTime(), size) + size
    const from = to - WINDOWS[window].ms
    const sums = new Map<number, EndedDTO>()
    const read = async (table: 'use_case_error_minute' | 'use_case_error_day', time: string, start: number, end: number) => {
      if (end <= start) return
      const where = whereOf(filter, 'use_case', 3, table === 'use_case_error_minute')
      for (const row of await this.analytics.query<{ slot: number, kind: Kind, count: number }>(`
        SELECT CAST(floor(epoch(CAST(${time} AS TIMESTAMP)) / ${seconds}) * ${seconds} AS BIGINT) AS slot, kind, sum(count) AS count
        FROM ${table} WHERE ${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($2 AS TIMESTAMP) AND ${where.sql}
        GROUP BY slot, kind`, [new Date(start).toISOString(), new Date(end).toISOString(), ...where.params])) {
        const sum = sums.get(row.slot * 1000) ?? none()
        sum[field(row.kind)] += row.count
        sums.set(row.slot * 1000, sum)
      }
    }
    if (size === BUCKETS['1d'] && filter.actor === undefined) {
      // Whole days the summary has, then the minutes after them.
      const [row] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM use_case_error_day')
      const split = Math.min(Math.max(row?.until ? Date.parse(row.until) : 0, from), to)
      await read('use_case_error_day', 'day', from, split)
      await read('use_case_error_minute', 'minute', split, to)
    } else {
      await read('use_case_error_minute', 'minute', from, to)
    }
    const total = none()
    const points: EndedPointDTO[] = []
    for (let at = from; at < to; at += size) {
      const sum = sums.get(at) ?? none()
      total.errors += sum.errors
      total.failures += sum.failures
      points.push({ at: new Date(at).toISOString(), ...sum })
    }
    return { window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(), points, total }
  }

  /** Each use case's errors and failures in the window, and in the one before: those with most failures first. */
  async totals(window: MetricsWindow, now: Date): Promise<ErrorsTotalDTO[]> {
    const length = WINDOWS[window].ms
    const end = now.getTime()
    const totals = new Map<string, ErrorsTotalDTO>()
    const [until] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM use_case_error_day')
    for (const span of spansOf(end - 2 * length, end, until?.until ? Date.parse(until.until) : 0)) {
      const [table, time] = span.table === 'day' ? ['use_case_error_day', 'day'] : ['use_case_error_minute', 'minute']
      for (const row of await this.analytics.query<{ context: string, use_case: string, recent: boolean, kind: Kind, count: number }>(`
        SELECT context, use_case, CAST(${time} AS TIMESTAMP) >= CAST($2 AS TIMESTAMP) AS recent, kind, sum(count) AS count FROM ${table}
        WHERE ${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($3 AS TIMESTAMP) GROUP BY context, use_case, recent, kind`,
      [new Date(span.start).toISOString(), new Date(end - length).toISOString(), new Date(span.end).toISOString()])) {
        const key = JSON.stringify([row.context, row.use_case])
        const total = totals.get(key) ?? { context: row.context, useCase: row.use_case, now: none(), previous: none() }
        total[row.recent ? 'now' : 'previous'][field(row.kind)] += row.count
        totals.set(key, total)
      }
    }
    return [...totals.values()].sort((a, b) => b.now.failures - a.now.failures || b.now.errors - a.now.errors || a.useCase.localeCompare(b.useCase))
  }

  /** How its calls ended by code in the window, and in the one before: the most first. */
  async codes(filter: MetricsFilter, window: MetricsWindow, now: Date): Promise<ErrorCodeDTO[]> {
    const length = WINDOWS[window].ms
    const end = now.getTime()
    const where = whereOf(filter, 'use_case', 4, true)
    const codes = new Map<string, ErrorCodeDTO>()
    for (const row of await this.analytics.query<{ kind: Kind, code: string, recent: boolean, count: number }>(`
      SELECT kind, code, minute >= $2 AS recent, sum(count) AS count FROM use_case_error_minute
      WHERE minute >= $1 AND minute < $3 AND ${where.sql} GROUP BY kind, code, recent`,
    [new Date(end - 2 * length).toISOString(), new Date(end - length).toISOString(), new Date(end).toISOString(), ...where.params])) {
      const key = `${row.kind}|${row.code}`
      const each = codes.get(key) ?? { kind: row.kind, code: row.code, count: 0, previous: 0 }
      each[row.recent ? 'count' : 'previous'] += row.count
      codes.set(key, each)
    }
    return [...codes.values()].sort((a, b) => b.count - a.count || b.previous - a.previous || a.code.localeCompare(b.code))
  }

  /** Who ended its calls in errors, or failures, most in the window: the ten first, by actor or by a scope's id. */
  async top(filter: MetricsFilter, window: MetricsWindow, by: string, kind: Kind, now: Date): Promise<ErrorsTopDTO[]> {
    const where = whereOf(filter, 'use_case', 3, true)
    const params: DuckDbParam[] = [new Date(now.getTime() - WINDOWS[window].ms).toISOString(), now.toISOString(), ...where.params]
    const value = by === 'actor' ? 'actor' : `json_extract_string(scopes, $${params.length + 1})`
    if (by !== 'actor') params.push(`$."${by.slice('scope:'.length)}"`)
    params.push(kind)
    return this.analytics.query<ErrorsTopDTO>(`
      SELECT ${value} AS value,
             sum(CASE WHEN kind = 'error' THEN count ELSE 0 END) AS errors,
             sum(CASE WHEN kind = 'failure' THEN count ELSE 0 END) AS failures
      FROM use_case_error_minute WHERE minute >= $1 AND minute < $2 AND ${where.sql}
      GROUP BY value HAVING sum(CASE WHEN kind = $${params.length} THEN count ELSE 0 END) > 0
      ORDER BY ${kind === 'error' ? 'errors' : 'failures'} DESC, value LIMIT 10`, params)
  }
}
