import type { EventCount } from 'newt/contract'
import { Module, now, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { AppGone, scopesText } from '../../../../shared/metrics-store/metrics-store'
import {
  DEFAULT_BUCKET, EventMetricsFeed, ScopesQuerySchema, SeriesQuerySchema, TopQuerySchema, TotalsQuerySchema,
  type CollectDTO, type EventTotalDTO, type SeriesDTO, type TopDTO,
} from './event-metrics'
import type { EventMetrics_Deps } from './event-metrics.deps'
import type { EventMetrics_Options } from './event-metrics-options'
import { EventMetricsFeed_Repository } from './event-metrics.repository'
import { registerEventMetricsRoutes } from './event-metrics.routes'
import { registerEventMetricsWorkers } from './event-metrics.workers'
import { EventMetricsQueries } from './services/event-metrics-queries'

const DAY_MS = 24 * 60 * 60_000

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/**
 * How many times each event of each application was told, minute by minute: collected
 * from it every minute into its DuckDB (`event_minute`), summed by day without actor
 * (`event_day`), and forgotten as its retention says.
 */
export class EventMetrics_Module extends Module {

  static initialize(base: MonitorBase, deps: EventMetrics_Deps, options: EventMetrics_Options): EventMetrics_Module {
    options.store.define({
      event_minute: { columns: { minute: 'TIMESTAMP', context: 'VARCHAR', event: 'VARCHAR', scopes: 'JSON', actor: 'VARCHAR', count: 'INTEGER' } },
      event_day: { columns: { day: 'DATE', context: 'VARCHAR', event: 'VARCHAR', scopes: 'JSON', count: 'BIGINT' } },
    })
    const module = new EventMetrics_Module(base, new EventMetricsFeed_Repository(base), deps, options)
    registerEventMetricsRoutes(base, module)
    registerEventMetricsWorkers(module, deps)
    return module
  }

  /** Every minute: what each application watched has closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: EventMetricsFeed_Repository, private readonly deps: EventMetrics_Deps, private readonly options: EventMetrics_Options) {
    super('eventMetrics', base.invocations, deps)
    this.minutely = base.schedules.define('eventMetrics.minutely', '* * * * *')
    this.nightly = base.schedules.define('eventMetrics.nightly', '30 3 * * *')
  }

  /**
   * Asks the application for the minutes closed since the last collection, and keeps
   * them. Collected twice, a minute is kept once.
   */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.repo.first({ appId }) ?? EventMetricsFeed.start(appId)
    const read = await this.deps.connection.fetchMetrics(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    // Deleted while it was asked: what it answered is not kept, nor its DuckDB opened again.
    if (!await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    try {
      await this.append(appId, read.value.counts)
    } catch (error) {
      if (error instanceof AppGone) return { appId, outcome: 'gone' }
      throw error
    }
    feed.collectedUntil(read.value.until)
    // A first feed is kept only for an application still there.
    if (feed.isNew && !await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    await this.repo.persist(feed)
    return { appId, outcome: 'collected', counts: read.value.counts.length, until: read.value.until }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectDTO[]> {
    const collected: CollectDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) collected.push(await this.collect(appId))
    return collected
  }

  /**
   * Sums each whole day at least two days old (an application keeps a day of minutes,
   * so none can come later), and forgets what its retention says is old.
   */
  @UseCase()
  async keep(appId: string): Promise<void> {
    const at = now()
    const { minuteDays, dayDays } = await this.deps.retention.of(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Deleted while its retention ran, its DuckDB dropped: nothing is left to keep.
    if (!analytics) return
    await analytics.run(`
      INSERT INTO event_day (id, day, context, event, scopes, count)
      SELECT strftime(CAST(minute AS DATE), '%Y-%m-%d') || '|' || context || '|' || event || '|' || CAST(scopes AS VARCHAR),
             CAST(minute AS DATE), context, event, scopes, sum(count)
      FROM event_minute WHERE minute < CAST($1 AS DATE)
      GROUP BY CAST(minute AS DATE), context, event, scopes
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    await analytics.run('DELETE FROM event_minute WHERE minute < CAST($1 AS TIMESTAMP)', [new Date(at.getTime() - minuteDays * DAY_MS).toISOString()])
    if (dayDays !== null) await analytics.run('DELETE FROM event_day WHERE day < CAST($1 AS DATE)', [dayBefore(at, dayDays)])
  }

  /** Keeps every application's event counts, archived ones too: their retention runs all the same. */
  @UseCase()
  async keepAll(): Promise<void> {
    for (const feed of await this.repo.find({})) await this.keep(feed.appId)
  }

  /** Each of its events' total in a window, beside the window before it: the busiest first. */
  @UseCase()
  async totals(appId: string, input: unknown): Promise<EventTotalDTO[]> {
    await this.deps.app.get(appId)
    const { window } = TotalsQuerySchema.parse(input)
    return (await this.queries(appId)).totals(window, now())
  }

  /** An event's series in a window, by bucket, filtered by scope or actor, beside the window it is compared with. */
  @UseCase()
  async series(appId: string, input: unknown): Promise<SeriesDTO> {
    await this.deps.app.get(appId)
    const query = SeriesQuerySchema.parse(input)
    return (await this.queries(appId)).series(query, query.window, query.bucket ?? DEFAULT_BUCKET[query.window], query.compare, now())
  }

  /** Who told an event most in a window: its actors, or the ids of one of its scopes. */
  @UseCase()
  async top(appId: string, input: unknown): Promise<TopDTO[]> {
    await this.deps.app.get(appId)
    const query = TopQuerySchema.parse(input)
    return (await this.queries(appId)).top(query, query.window, query.by, now())
  }

  /** The scopes an event was told in, by name, in a window: what its tellers can be grouped by. */
  @UseCase()
  async scopes(appId: string, input: unknown): Promise<string[]> {
    await this.deps.app.get(appId)
    const query = ScopesQuerySchema.parse(input)
    return (await this.queries(appId)).scopeNames(query, query.window, now())
  }

  /**
   * Its counts as they come, as server-sent events, while the request lasts: what the
   * application sends, passed on. One archived, or not answering, sends an `error` event.
   */
  @UseCase()
  async live(appId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const app = await this.deps.app.get(appId)
    const failed = (message: string) => new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`).body!
    if (app.archivedAt !== null) return failed('It is archived: it is not watched')
    const stream = await this.deps.connection.live(appId, signal)
    return stream.answered ? stream.value : failed(stream.failure.message)
  }

  /** Forgets everything of an application deleted: its feed, and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Another module dropped its DuckDB already: nothing of it is left.
    if (!analytics) return
    await analytics.run('DELETE FROM event_minute')
    await analytics.run('DELETE FROM event_day')
    await this.options.store.dropIfEmpty(appId)
  }

  private async append(appId: string, counts: EventCount[]): Promise<void> {
    const rows = counts.map(count => {
      const scopes = scopesText(count.scopes)
      // The column is JSON: the object goes in as it is, its keys in order, so a day's sum groups it as one.
      return { id: `${count.minute}|${count.context}|${count.event}|${scopes}|${count.actor ?? ''}`, ...count, scopes: JSON.parse(scopes) as Record<string, string> }
    })
    await (await this.options.store.of(appId)).append('event_minute', rows)
  }

  private async queries(appId: string): Promise<EventMetricsQueries> {
    return new EventMetricsQueries(await this.options.store.of(appId))
  }
}
