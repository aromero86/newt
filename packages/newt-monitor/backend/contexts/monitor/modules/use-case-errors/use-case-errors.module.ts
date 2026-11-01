import type { UseCaseTiming } from '@newt-kit/newt/contract'
import { Module, now, UseCase } from '@newt-kit/newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { eachApp } from '../../../../shared/each-app'
import { AppGone, scopesText } from '../../../../shared/metrics-store/metrics-store'
import { DEFAULT_BUCKET } from '../event-metrics/event-metrics.schema'
import {
  ErrorCodesQuerySchema, ErrorsSeriesQuerySchema, ErrorsTopQuerySchema, ErrorsTotalsQuerySchema, UseCaseErrorsFeed,
  type CollectErrorsDTO, type ErrorCodeDTO, type ErrorsSeriesDTO, type ErrorsTopDTO, type ErrorsTotalDTO,
} from './use-case-errors'
import type { UseCaseErrors_Deps } from './use-case-errors.deps'
import type { UseCaseErrors_Options } from './use-case-errors-options'
import { UseCaseErrorsFeed_Repository } from './use-case-errors.repository'
import { registerUseCaseErrorsRoutes } from './use-case-errors.routes'
import { registerUseCaseErrorsWorkers } from './use-case-errors.workers'
import { UseCaseErrorsQueries } from './services/use-case-errors-queries'

const DAY_MS = 24 * 60 * 60_000

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/**
 * How each use case's calls of each application ended badly: in an error they say may
 * happen, or in a failure nobody expected, by code, minute by minute. Collected every
 * minute into its DuckDB, summed by day without actor, forgotten as its retention says.
 */
export class UseCaseErrors_Module extends Module {

  static initialize(base: MonitorBase, deps: UseCaseErrors_Deps, options: UseCaseErrors_Options): UseCaseErrors_Module {
    const ended = { context: 'VARCHAR', use_case: 'VARCHAR', scopes: 'JSON', kind: 'VARCHAR', code: 'VARCHAR' } as const
    options.store.define({
      use_case_error_minute: { columns: { minute: 'TIMESTAMP', ...ended, actor: 'VARCHAR', count: 'INTEGER' } },
      use_case_error_day: { columns: { day: 'DATE', ...ended, count: 'BIGINT' } },
    })
    const module = new UseCaseErrors_Module(base, new UseCaseErrorsFeed_Repository(base), deps, options)
    registerUseCaseErrorsRoutes(base, module)
    registerUseCaseErrorsWorkers(module, deps)
    return module
  }

  /** Every minute: what each application watched has closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: UseCaseErrorsFeed_Repository, private readonly deps: UseCaseErrors_Deps, private readonly options: UseCaseErrors_Options) {
    super('useCaseErrors', base.invocations, deps)
    this.minutely = base.schedules.define('useCaseErrors.minutely', '* * * * *')
    this.nightly = base.schedules.define('useCaseErrors.nightly', '50 3 * * *')
  }

  /** Asks the application how its calls ended in the minutes closed since the last collection, and keeps their errors and failures. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectErrorsDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.repo.first({ appId }) ?? UseCaseErrorsFeed.start(appId)
    const read = await this.deps.connection.fetchTimings(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    // Deleted while it was asked: what it answered is not kept, nor its DuckDB opened again.
    if (!await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    let counted: number
    try {
      counted = await this.append(appId, read.value.timings)
    } catch (error) {
      if (error instanceof AppGone) return { appId, outcome: 'gone' }
      throw error
    }
    feed.collectedUntil(read.value.until)
    // A first feed is kept only for an application still there.
    if (feed.isNew && !await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    await this.repo.persist(feed)
    return { appId, outcome: 'collected', counted, until: read.value.until }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so, one that fails too, and the others go on. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectErrorsDTO[]> {
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
    await analytics.run(`
      INSERT INTO use_case_error_day (id, day, context, use_case, scopes, kind, code, count)
      SELECT strftime(CAST(minute AS DATE), '%Y-%m-%d') || '|' || context || '|' || use_case || '|' || CAST(scopes AS VARCHAR) || '|' || kind || '|' || code,
             CAST(minute AS DATE), context, use_case, scopes, kind, code, sum(count)
      FROM use_case_error_minute WHERE minute < CAST($1 AS DATE)
      GROUP BY CAST(minute AS DATE), context, use_case, scopes, kind, code
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    await analytics.run('DELETE FROM use_case_error_minute WHERE minute < CAST($1 AS TIMESTAMP)', [new Date(at.getTime() - minuteDays * DAY_MS).toISOString()])
    if (dayDays !== null) await analytics.run('DELETE FROM use_case_error_day WHERE day < CAST($1 AS DATE)', [dayBefore(at, dayDays)])
  }

  /** Keeps every application's errors, archived ones too: their retention runs all the same, and one that fails keeps none of the others from it. */
  @UseCase()
  async keepAll(): Promise<void> {
    await eachApp((await this.repo.find({})).map(feed => feed.appId), appId => this.keep(appId), () => undefined)
  }

  /** Each of its use cases' errors and failures in a window, beside the window before: the most failing first. */
  @UseCase()
  async totals(appId: string, input: unknown): Promise<ErrorsTotalDTO[]> {
    await this.deps.app.get(appId)
    const { window } = ErrorsTotalsQuerySchema.parse(input)
    return (await this.queries(appId)).totals(window, now())
  }

  /** A use case's errors and failures in a window, by bucket, filtered by scope or actor. */
  @UseCase()
  async series(appId: string, input: unknown): Promise<ErrorsSeriesDTO> {
    await this.deps.app.get(appId)
    const query = ErrorsSeriesQuerySchema.parse(input)
    return (await this.queries(appId)).series({ context: query.context, name: query.useCase, scope: query.scope, actor: query.actor }, query.window, query.bucket ?? DEFAULT_BUCKET[query.window], now())
  }

  /** How a use case's calls ended by code in a window, beside the window before. */
  @UseCase()
  async codes(appId: string, input: unknown): Promise<ErrorCodeDTO[]> {
    await this.deps.app.get(appId)
    const query = ErrorCodesQuerySchema.parse(input)
    return (await this.queries(appId)).codes({ context: query.context, name: query.useCase, scope: query.scope, actor: query.actor }, query.window, now())
  }

  /** Who ended a use case's calls in errors, or failures, most in a window: its actors, or the ids of one of its scopes. */
  @UseCase()
  async top(appId: string, input: unknown): Promise<ErrorsTopDTO[]> {
    await this.deps.app.get(appId)
    const query = ErrorsTopQuerySchema.parse(input)
    return (await this.queries(appId)).top({ context: query.context, name: query.useCase }, query.window, query.by, query.kind, now())
  }

  /** Forgets everything of an application deleted: its feed, and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Another module dropped its DuckDB already: nothing of it is left.
    if (!analytics) return
    for (const table of ['use_case_error_minute', 'use_case_error_day']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  /** Its errors and failures, a row per minute, key and code; how many rows. */
  private async append(appId: string, timings: UseCaseTiming[]): Promise<number> {
    const rows = timings.flatMap(timing => {
      const scopes = scopesText(timing.scopes)
      const row = { minute: timing.minute, context: timing.context, use_case: timing.useCase, scopes: JSON.parse(scopes) as Record<string, string>, actor: timing.actor }
      const id = `${timing.minute}|${timing.context}|${timing.useCase}|${scopes}|${timing.actor ?? ''}`
      return (['error', 'failure'] as const).flatMap(kind => Object.entries(kind === 'error' ? timing.errors : timing.failures)
        .map(([code, count]) => ({ id: `${id}|${kind}|${code}`, ...row, kind, code, count })))
    })
    await (await this.options.store.of(appId)).append('use_case_error_minute', rows)
    return rows.length
  }

  private async queries(appId: string): Promise<UseCaseErrorsQueries> {
    return new UseCaseErrorsQueries(await this.options.store.of(appId))
  }
}
