import type { UseCaseTiming } from 'newt/contract'
import { Module, now, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { eachApp } from '../../../../shared/each-app'
import { AppGone, scopesText } from '../../../../shared/metrics-store/metrics-store'
import { DEFAULT_BUCKET } from '../event-metrics/event-metrics.schema'
import {
  UseCaseMetricsFeed, UseCaseScopesQuerySchema, UseCaseSeriesQuerySchema, UseCaseTopQuerySchema, UseCaseTotalsQuerySchema,
  type CollectTimingsDTO, type UseCaseSeriesDTO, type UseCaseTopDTO, type UseCaseTotalDTO,
} from './use-case-metrics'
import type { UseCaseMetrics_Deps } from './use-case-metrics.deps'
import type { UseCaseMetrics_Options } from './use-case-metrics-options'
import { UseCaseMetricsFeed_Repository } from './use-case-metrics.repository'
import { registerUseCaseMetricsRoutes } from './use-case-metrics.routes'
import { registerUseCaseMetricsWorkers } from './use-case-metrics.workers'
import { UseCaseMetricsQueries } from './services/use-case-metrics-queries'

const DAY_MS = 24 * 60 * 60_000

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/** What a minute's and a day's timings are kept as, and their histograms, a row per bucket. */
const TIMING = { context: 'VARCHAR', use_case: 'VARCHAR', scopes: 'JSON' } as const

/**
 * How each use case of each application went, minute by minute: how many calls, how
 * many runs more after a conflict, how long, on average and by percentile. Collected
 * every minute into its DuckDB, summed by day without actor, forgotten as its retention says.
 */
export class UseCaseMetrics_Module extends Module {

  static initialize(base: MonitorBase, deps: UseCaseMetrics_Deps, options: UseCaseMetrics_Options): UseCaseMetrics_Module {
    options.store.define({
      use_case_minute: { columns: { minute: 'TIMESTAMP', ...TIMING, actor: 'VARCHAR', calls: 'INTEGER', retries: 'INTEGER', total_ms: 'DOUBLE' } },
      use_case_minute_bucket: { columns: { minute: 'TIMESTAMP', ...TIMING, actor: 'VARCHAR', bucket: 'INTEGER', count: 'INTEGER' } },
      use_case_day: { columns: { day: 'DATE', ...TIMING, calls: 'BIGINT', retries: 'BIGINT', total_ms: 'DOUBLE' } },
      use_case_day_bucket: { columns: { day: 'DATE', ...TIMING, bucket: 'INTEGER', count: 'BIGINT' } },
    })
    const module = new UseCaseMetrics_Module(base, new UseCaseMetricsFeed_Repository(base), deps, options)
    registerUseCaseMetricsRoutes(base, module)
    registerUseCaseMetricsWorkers(module, deps)
    return module
  }

  /** Every minute: what each application watched has closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: UseCaseMetricsFeed_Repository, private readonly deps: UseCaseMetrics_Deps, private readonly options: UseCaseMetrics_Options) {
    super('useCaseMetrics', base.invocations, deps)
    this.minutely = base.schedules.define('useCaseMetrics.minutely', '* * * * *')
    this.nightly = base.schedules.define('useCaseMetrics.nightly', '40 3 * * *')
  }

  /** Asks the application for the minutes closed since the last collection, and keeps them. Collected twice, a minute is kept once. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectTimingsDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.repo.first({ appId }) ?? UseCaseMetricsFeed.start(appId)
    const read = await this.deps.connection.fetchTimings(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    // Deleted while it was asked: what it answered is not kept, nor its DuckDB opened again.
    if (!await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    try {
      await this.append(appId, read.value.timings)
    } catch (error) {
      if (error instanceof AppGone) return { appId, outcome: 'gone' }
      throw error
    }
    feed.collectedUntil(read.value.until)
    // A first feed is kept only for an application still there.
    if (feed.isNew && !await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    await this.repo.persist(feed)
    return { appId, outcome: 'collected', timings: read.value.timings.length, until: read.value.until }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so, one that fails too, and the others go on. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectTimingsDTO[]> {
    return eachApp(await this.deps.app.watchedIds(), appId => this.collect(appId), (appId, message) => ({ appId, outcome: 'failed', message }))
  }

  /** Sums each whole day at least two days old, and forgets what its retention says is old. */
  @UseCase()
  async keep(appId: string): Promise<void> {
    const at = now()
    const { minuteDays, dayDays } = await this.deps.retention.of(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Deleted while its retention ran, its DuckDB dropped: nothing is left to keep.
    if (!analytics) return
    const day = `strftime(CAST(minute AS DATE), '%Y-%m-%d') || '|' || context || '|' || use_case || '|' || CAST(scopes AS VARCHAR)`
    await analytics.run(`
      INSERT INTO use_case_day (id, day, context, use_case, scopes, calls, retries, total_ms)
      SELECT ${day}, CAST(minute AS DATE), context, use_case, scopes, sum(calls), sum(retries), sum(total_ms)
      FROM use_case_minute WHERE minute < CAST($1 AS DATE)
      GROUP BY CAST(minute AS DATE), context, use_case, scopes
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    await analytics.run(`
      INSERT INTO use_case_day_bucket (id, day, context, use_case, scopes, bucket, count)
      SELECT ${day} || '|' || bucket, CAST(minute AS DATE), context, use_case, scopes, bucket, sum(count)
      FROM use_case_minute_bucket WHERE minute < CAST($1 AS DATE)
      GROUP BY CAST(minute AS DATE), context, use_case, scopes, bucket
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    const minutesBefore = new Date(at.getTime() - minuteDays * DAY_MS).toISOString()
    for (const table of ['use_case_minute', 'use_case_minute_bucket']) await analytics.run(`DELETE FROM ${table} WHERE minute < CAST($1 AS TIMESTAMP)`, [minutesBefore])
    if (dayDays !== null) {
      for (const table of ['use_case_day', 'use_case_day_bucket']) await analytics.run(`DELETE FROM ${table} WHERE day < CAST($1 AS DATE)`, [dayBefore(at, dayDays)])
    }
  }

  /** Keeps every application's timings, archived ones too: their retention runs all the same, and one that fails keeps none of the others from it. */
  @UseCase()
  async keepAll(): Promise<void> {
    await eachApp((await this.repo.find({})).map(feed => feed.appId), appId => this.keep(appId), () => undefined)
  }

  /** Each of its use cases' calls in a window, beside the window before: the most called first. */
  @UseCase()
  async totals(appId: string, input: unknown): Promise<UseCaseTotalDTO[]> {
    await this.deps.app.get(appId)
    const { window } = UseCaseTotalsQuerySchema.parse(input)
    return (await this.queries(appId)).totals(window, now())
  }

  /** A use case's calls in a window, by bucket, with their mean and percentiles, filtered by scope or actor, beside the window it is compared with. */
  @UseCase()
  async series(appId: string, input: unknown): Promise<UseCaseSeriesDTO> {
    await this.deps.app.get(appId)
    const query = UseCaseSeriesQuerySchema.parse(input)
    const filter = { context: query.context, name: query.useCase, scope: query.scope, actor: query.actor }
    return (await this.queries(appId)).series(filter, query.window, query.bucket ?? DEFAULT_BUCKET[query.window], query.compare, now())
  }

  /** Who called a use case most in a window, or made it run again most, and how their calls went: its actors, or the ids of one of its scopes. */
  @UseCase()
  async top(appId: string, input: unknown): Promise<UseCaseTopDTO[]> {
    await this.deps.app.get(appId)
    const query = UseCaseTopQuerySchema.parse(input)
    return (await this.queries(appId)).top({ context: query.context, name: query.useCase }, query.window, query.by, query.order, now())
  }

  /** The scopes a use case was called in, by name, in a window: what its callers can be grouped by. */
  @UseCase()
  async scopes(appId: string, input: unknown): Promise<string[]> {
    await this.deps.app.get(appId)
    const query = UseCaseScopesQuerySchema.parse(input)
    return (await this.queries(appId)).scopeNames({ context: query.context, name: query.useCase }, query.window, now())
  }

  /** Forgets everything of an application deleted: its feed, and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Another module dropped its DuckDB already: nothing of it is left.
    if (!analytics) return
    for (const table of ['use_case_minute', 'use_case_minute_bucket', 'use_case_day', 'use_case_day_bucket']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  private async append(appId: string, timings: UseCaseTiming[]): Promise<void> {
    const analytics = await this.options.store.of(appId)
    const rows = timings.map(timing => {
      const scopes = scopesText(timing.scopes)
      const id = `${timing.minute}|${timing.context}|${timing.useCase}|${scopes}|${timing.actor ?? ''}`
      const row = { minute: timing.minute, context: timing.context, use_case: timing.useCase, scopes: JSON.parse(scopes) as Record<string, string>, actor: timing.actor }
      return {
        minute: { id, ...row, calls: timing.calls, retries: timing.retries, total_ms: timing.totalMs },
        buckets: Object.entries(timing.histogram).map(([bucket, count]) => ({ id: `${id}|${bucket}`, ...row, bucket: Number(bucket), count })),
      }
    })
    await analytics.append('use_case_minute', rows.map(row => row.minute))
    await analytics.append('use_case_minute_bucket', rows.flatMap(row => row.buckets))
  }

  private async queries(appId: string): Promise<UseCaseMetricsQueries> {
    return new UseCaseMetricsQueries(await this.options.store.of(appId))
  }
}
