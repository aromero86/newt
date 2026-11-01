import type { DuckDbAnalytics, DuckDbParam } from 'newt-kit/adapter-duckdb'
import { histogramPercentile } from 'newt-kit/contract'
import { spansOf } from '../../../../../shared/metrics-store/metrics-spans'
import { whereOf, type MetricsFilter } from '../../../../../shared/metrics-store/metrics-filter'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../../event-metrics/event-metrics.schema'
import type { LatencyDTO, LatencyPointDTO, UseCaseSeriesDTO, UseCaseTopDTO, UseCaseTotalDTO } from '../use-case-metrics.schema'

/** Calls, retries, time and histogram, as they add up. */
type Sum = { calls: number, retries: number, totalMs: number, histogram: Record<string, number> }

const empty = (): Sum => ({ calls: 0, retries: 0, totalMs: 0, histogram: {} })

/** How a sum of calls went: its mean and its percentiles out of its histogram. */
export function latencyOf(sum: Sum): LatencyDTO {
  const at = (percentile: number) => histogramPercentile(sum.histogram, percentile)
  return {
    calls: sum.calls, retries: sum.retries, meanMs: sum.calls ? sum.totalMs / sum.calls : null,
    p50: at(50), p75: at(75), p90: at(90), p99: at(99),
  }
}

const floor = (ms: number, size: number) => ms - (ms % size)

/**
 * What a panel reads of an application's use case timings, in DuckDB's SQL: calls and
 * time summed by bucket as they are read, histograms too, and the percentiles out of
 * those. Days older than the summary's newest come from it; the rest, and anything
 * filtered by actor, from the minutes.
 */
export class UseCaseMetricsQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  async series(filter: MetricsFilter, window: MetricsWindow, bucket: MetricsBucket, compare: 'previous' | 'week' | 'none', now: Date): Promise<UseCaseSeriesDTO> {
    const size = BUCKETS[bucket]
    const length = WINDOWS[window].ms
    const to = floor(now.getTime(), size) + size
    const from = to - length
    const [points, total] = await this.points(filter, from, to, size)
    const shift = compare === 'week' ? 7 * 24 * 60 * 60_000 : length
    const before = compare === 'none' ? null : await this.points(filter, from - shift, to - shift, size)
    return {
      window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      points, total: latencyOf(total),
      compared: before ? before[0].map(point => ({ ...point, at: new Date(Date.parse(point.at) + shift).toISOString() })) : null,
      comparedTotal: before ? latencyOf(before[1]) : null,
    }
  }

  /** Each use case's calls in the window, and in the one just before: the most called first. */
  async totals(window: MetricsWindow, now: Date): Promise<UseCaseTotalDTO[]> {
    const length = WINDOWS[window].ms
    const end = now.getTime()
    const sums = new Map<string, { now: Sum, previous: Sum }>()
    const of = (context: string, useCase: string) => {
      const key = JSON.stringify([context, useCase])
      if (!sums.has(key)) sums.set(key, { now: empty(), previous: empty() })
      return sums.get(key)!
    }
    const [until] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM use_case_day')
    for (const span of spansOf(end - 2 * length, end, until?.until ? Date.parse(until.until) : 0)) {
      const [table, time] = span.table === 'day' ? ['use_case_day', 'day'] : ['use_case_minute', 'minute']
      const params = [new Date(span.start).toISOString(), new Date(end - length).toISOString(), new Date(span.end).toISOString()]
      const recent = `CAST(${time} AS TIMESTAMP) >= CAST($2 AS TIMESTAMP)`
      const range = `${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($3 AS TIMESTAMP)`
      for (const row of await this.analytics.query<{ context: string, use_case: string, recent: boolean, calls: number, retries: number, total_ms: number }>(`
        SELECT context, use_case, ${recent} AS recent, sum(calls) AS calls, sum(retries) AS retries, sum(total_ms) AS total_ms
        FROM ${table} WHERE ${range} GROUP BY context, use_case, recent`, params)) {
        const sum = of(row.context, row.use_case)[row.recent ? 'now' : 'previous']
        sum.calls += row.calls
        sum.retries += row.retries
        sum.totalMs += row.total_ms
      }
      for (const row of await this.analytics.query<{ context: string, use_case: string, recent: boolean, bucket: number, count: number }>(`
        SELECT context, use_case, ${recent} AS recent, bucket, sum(count) AS count
        FROM ${table}_bucket WHERE ${range} GROUP BY context, use_case, recent, bucket`, params)) {
        const histogram = of(row.context, row.use_case)[row.recent ? 'now' : 'previous'].histogram
        histogram[String(row.bucket)] = (histogram[String(row.bucket)] ?? 0) + row.count
      }
    }
    return [...sums].map(([key, sum]) => {
      const [context, useCase] = JSON.parse(key) as [string, string]
      return { context, useCase, now: latencyOf(sum.now), previous: latencyOf(sum.previous) }
    }).sort((a, b) => b.now.calls - a.now.calls || a.useCase.localeCompare(b.useCase))
  }

  /** Who called it most in the window, or made it run again most, the ten first, by actor or by a scope's id, and how their calls went. */
  async top(filter: MetricsFilter, window: MetricsWindow, by: string, order: 'calls' | 'retries', now: Date): Promise<UseCaseTopDTO[]> {
    const where = whereOf(filter, 'use_case', 3, true)
    const params: DuckDbParam[] = [new Date(now.getTime() - WINDOWS[window].ms).toISOString(), now.toISOString(), ...where.params]
    const value = by === 'actor' ? 'actor' : `json_extract_string(scopes, $${params.length + 1})`
    if (by !== 'actor') params.push(`$."${by.slice('scope:'.length)}"`)
    const rows = await this.analytics.query<{ value: string | null, calls: number, retries: number, total_ms: number }>(`
      SELECT ${value} AS value, sum(calls) AS calls, sum(retries) AS retries, sum(total_ms) AS total_ms FROM use_case_minute
      WHERE minute >= $1 AND minute < $2 AND ${where.sql} GROUP BY value
      ${order === 'retries' ? 'HAVING sum(retries) > 0 ORDER BY retries DESC, calls DESC' : 'ORDER BY calls DESC'}, value LIMIT 10`, params)
    const histograms = new Map<string | null, Record<string, number>>()
    for (const row of await this.analytics.query<{ value: string | null, bucket: number, count: number }>(`
      SELECT ${value} AS value, bucket, sum(count) AS count FROM use_case_minute_bucket
      WHERE minute >= $1 AND minute < $2 AND ${where.sql} GROUP BY value, bucket`, params)) {
      const histogram = histograms.get(row.value) ?? {}
      histogram[String(row.bucket)] = row.count
      histograms.set(row.value, histogram)
    }
    return rows.map(row => ({ value: row.value, ...latencyOf({ calls: row.calls, retries: row.retries, totalMs: row.total_ms, histogram: histograms.get(row.value) ?? {} }) }))
  }

  /** The names of the scopes it was called in, in the window. */
  async scopeNames(filter: MetricsFilter, window: MetricsWindow, now: Date): Promise<string[]> {
    const where = whereOf(filter, 'use_case', 3, false)
    const rows = await this.analytics.query<{ name: string }>(`
      SELECT DISTINCT unnest(json_keys(scopes)) AS name FROM use_case_minute
      WHERE minute >= $1 AND minute < $2 AND ${where.sql} ORDER BY name`,
    [new Date(now.getTime() - WINDOWS[window].ms).toISOString(), now.toISOString(), ...where.params])
    return rows.map(row => row.name)
  }

  /** Every bucket from `from` to `to`, those with no call empty, and their sum. */
  private async points(filter: MetricsFilter, from: number, to: number, size: number): Promise<[LatencyPointDTO[], Sum]> {
    const seconds = size / 1000
    const sums = new Map<number, Sum>()
    const sumAt = (at: number) => {
      if (!sums.has(at)) sums.set(at, empty())
      return sums.get(at)!
    }
    const read = async (table: 'use_case_minute' | 'use_case_day', time: string, start: number, end: number) => {
      if (end <= start) return
      const withActor = table === 'use_case_minute'
      const where = whereOf(filter, 'use_case', 3, withActor)
      const params: DuckDbParam[] = [new Date(start).toISOString(), new Date(end).toISOString(), ...where.params]
      const bucketOf = `CAST(floor(epoch(CAST(${time} AS TIMESTAMP)) / ${seconds}) * ${seconds} AS BIGINT)`
      const range = `${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($2 AS TIMESTAMP) AND ${where.sql}`
      for (const row of await this.analytics.query<{ slot: number, calls: number, retries: number, total_ms: number }>(
        `SELECT ${bucketOf} AS slot, sum(calls) AS calls, sum(retries) AS retries, sum(total_ms) AS total_ms FROM ${table} WHERE ${range} GROUP BY slot`, params)) {
        const sum = sumAt(row.slot * 1000)
        sum.calls += row.calls
        sum.retries += row.retries
        sum.totalMs += row.total_ms
      }
      for (const row of await this.analytics.query<{ slot: number, bucket: number, count: number }>(
        `SELECT ${bucketOf} AS slot, bucket, sum(count) AS count FROM ${table}_bucket WHERE ${range} GROUP BY slot, bucket`, params)) {
        const histogram = sumAt(row.slot * 1000).histogram
        histogram[String(row.bucket)] = (histogram[String(row.bucket)] ?? 0) + row.count
      }
    }
    if (size === BUCKETS['1d'] && filter.actor === undefined) {
      // Whole days the summary has, then the minutes after them.
      const [row] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM use_case_day')
      const split = Math.min(Math.max(row?.until ? Date.parse(row.until) : 0, from), to)
      await read('use_case_day', 'day', from, split)
      await read('use_case_minute', 'minute', split, to)
    } else {
      await read('use_case_minute', 'minute', from, to)
    }
    const total = empty()
    const points: LatencyPointDTO[] = []
    for (let at = from; at < to; at += size) {
      const sum = sums.get(at) ?? empty()
      total.calls += sum.calls
      total.retries += sum.retries
      total.totalMs += sum.totalMs
      for (const [bucket, count] of Object.entries(sum.histogram)) total.histogram[bucket] = (total.histogram[bucket] ?? 0) + count
      points.push({ at: new Date(at).toISOString(), ...latencyOf(sum) })
    }
    return [points, total]
  }
}
