import type { DuckDbAnalytics, DuckDbParam } from 'newt-kit/adapter-duckdb'
import { histogramPercentile } from 'newt-kit/contract'
import { spansOf } from '../../../../../shared/metrics-store/metrics-spans'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../../event-metrics/event-metrics.schema'
import type { FlowDTO, FlowPointDTO, QueueSeriesDTO, QueueTotalDTO } from '../queue-metrics.schema'

/** A queue's flow as it adds up: its counts and its wait histogram. */
type Sum = { published: number, delivered: number, redelivered: number, dead: number, wait: Record<string, number> }

const empty = (): Sum => ({ published: 0, delivered: 0, redelivered: 0, dead: 0, wait: {} })

function flowOf(sum: Sum): FlowDTO {
  return {
    published: sum.published, delivered: sum.delivered, redelivered: sum.redelivered, dead: sum.dead,
    waitP50: histogramPercentile(sum.wait, 50), waitP90: histogramPercentile(sum.wait, 90), waitP99: histogramPercentile(sum.wait, 99),
  }
}

function add(to: Sum, from: Sum): void {
  to.published += from.published
  to.delivered += from.delivered
  to.redelivered += from.redelivered
  to.dead += from.dead
  for (const [bucket, count] of Object.entries(from.wait)) to.wait[bucket] = (to.wait[bucket] ?? 0) + count
}

const floor = (ms: number, size: number) => ms - (ms % size)

/**
 * What a panel reads of an application's queue flows, in DuckDB's SQL: counts and the
 * wait's histogram summed by bucket as they are read. Days older than the summary's
 * newest come from it, the rest from the minutes.
 */
export class QueueMetricsQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  async series(context: string | undefined, queue: string | undefined, window: MetricsWindow, bucket: MetricsBucket, compare: 'previous' | 'week' | 'none', now: Date): Promise<QueueSeriesDTO> {
    const size = BUCKETS[bucket]
    const length = WINDOWS[window].ms
    const to = floor(now.getTime(), size) + size
    const from = to - length
    const [points, total] = await this.points(context, queue, from, to, size)
    const shift = compare === 'week' ? 7 * 24 * 60 * 60_000 : length
    const before = compare === 'none' ? null : await this.points(context, queue, from - shift, to - shift, size)
    return {
      window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(), points, total: flowOf(total),
      compared: before ? before[0].map(point => ({ ...point, at: new Date(Date.parse(point.at) + shift).toISOString() })) : null,
      comparedTotal: before ? flowOf(before[1]) : null,
    }
  }

  /** Each queue's flow in the window, and in the one before: the busiest first. */
  async totals(window: MetricsWindow, now: Date): Promise<QueueTotalDTO[]> {
    const length = WINDOWS[window].ms
    const end = now.getTime()
    const sums = new Map<string, { now: Sum, previous: Sum }>()
    const of = (context: string, queue: string) => {
      const key = JSON.stringify([context, queue])
      if (!sums.has(key)) sums.set(key, { now: empty(), previous: empty() })
      return sums.get(key)!
    }
    const [until] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM queue_day')
    for (const span of spansOf(end - 2 * length, end, until?.until ? Date.parse(until.until) : 0)) {
      const [table, time] = span.table === 'day' ? ['queue_day', 'day'] : ['queue_minute', 'minute']
      const params = [new Date(span.start).toISOString(), new Date(end - length).toISOString(), new Date(span.end).toISOString()]
      const recent = `CAST(${time} AS TIMESTAMP) >= CAST($2 AS TIMESTAMP)`
      const range = `${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($3 AS TIMESTAMP)`
      for (const row of await this.analytics.query<{ context: string, queue: string, recent: boolean, published: number, delivered: number, redelivered: number, dead: number }>(`
        SELECT context, queue, ${recent} AS recent, sum(published) AS published, sum(delivered) AS delivered, sum(redelivered) AS redelivered, sum(dead) AS dead
        FROM ${table} WHERE ${range} GROUP BY context, queue, recent`, params)) {
        add(of(row.context, row.queue)[row.recent ? 'now' : 'previous'], { ...row, wait: {} })
      }
      for (const row of await this.analytics.query<{ context: string, queue: string, recent: boolean, bucket: number, count: number }>(`
        SELECT context, queue, ${recent} AS recent, bucket, sum(count) AS count
        FROM ${table}_wait WHERE ${range} GROUP BY context, queue, recent, bucket`, params)) {
        const wait = of(row.context, row.queue)[row.recent ? 'now' : 'previous'].wait
        wait[String(row.bucket)] = (wait[String(row.bucket)] ?? 0) + row.count
      }
    }
    return [...sums].map(([key, sum]) => {
      const [context, queue] = JSON.parse(key) as [string, string]
      return { context, queue, now: flowOf(sum.now), previous: flowOf(sum.previous) }
    }).sort((a, b) => b.now.published - a.now.published || a.queue.localeCompare(b.queue))
  }

  /** Every bucket from `from` to `to`, those with nothing empty, and their sum. */
  private async points(context: string | undefined, queue: string | undefined, from: number, to: number, size: number): Promise<[FlowPointDTO[], Sum]> {
    const seconds = size / 1000
    const sums = new Map<number, Sum>()
    const sumAt = (at: number) => {
      if (!sums.has(at)) sums.set(at, empty())
      return sums.get(at)!
    }
    const read = async (table: 'queue_minute' | 'queue_day', time: string, start: number, end: number) => {
      if (end <= start) return
      const params: DuckDbParam[] = [new Date(start).toISOString(), new Date(end).toISOString(), context ?? null, queue ?? null]
      const slot = `CAST(floor(epoch(CAST(${time} AS TIMESTAMP)) / ${seconds}) * ${seconds} AS BIGINT)`
      const range = `${time} >= CAST($1 AS TIMESTAMP) AND ${time} < CAST($2 AS TIMESTAMP) AND (CAST($3 AS VARCHAR) IS NULL OR context = $3) AND (CAST($4 AS VARCHAR) IS NULL OR queue = $4)`
      for (const row of await this.analytics.query<{ slot: number, published: number, delivered: number, redelivered: number, dead: number }>(
        `SELECT ${slot} AS slot, sum(published) AS published, sum(delivered) AS delivered, sum(redelivered) AS redelivered, sum(dead) AS dead FROM ${table} WHERE ${range} GROUP BY slot`, params)) {
        add(sumAt(row.slot * 1000), { ...row, wait: {} })
      }
      for (const row of await this.analytics.query<{ slot: number, bucket: number, count: number }>(
        `SELECT ${slot} AS slot, bucket, sum(count) AS count FROM ${table}_wait WHERE ${range} GROUP BY slot, bucket`, params)) {
        const wait = sumAt(row.slot * 1000).wait
        wait[String(row.bucket)] = (wait[String(row.bucket)] ?? 0) + row.count
      }
    }
    if (size === BUCKETS['1d']) {
      // Whole days the summary has, then the minutes after them.
      const [row] = await this.analytics.query<{ until: string | null }>('SELECT max(day) + INTERVAL 1 DAY AS until FROM queue_day')
      const split = Math.min(Math.max(row?.until ? Date.parse(row.until) : 0, from), to)
      await read('queue_day', 'day', from, split)
      await read('queue_minute', 'minute', split, to)
    } else {
      await read('queue_minute', 'minute', from, to)
    }
    const total = empty()
    const points: FlowPointDTO[] = []
    for (let at = from; at < to; at += size) {
      const sum = sums.get(at) ?? empty()
      add(total, sum)
      points.push({ at: new Date(at).toISOString(), ...flowOf(sum) })
    }
    return [points, total]
  }
}
