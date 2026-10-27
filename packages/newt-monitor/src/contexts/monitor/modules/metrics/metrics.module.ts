import { Module, now, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import {
  DEFAULT_BUCKET, MetricsFeed, MetricsRetentionSchema, SeriesQuerySchema, TopQuerySchema, TotalsQuerySchema,
  type CollectDTO, type EventTotalDTO, type MetricsRetentionDTO, type SeriesDTO, type TopDTO,
} from './metrics'
import type { Metrics_Deps } from './metrics.deps'
import type { Metrics_Options } from './metrics-options'
import { MetricsFeed_Repository } from './metrics.repository'
import { registerMetricsRoutes } from './metrics.routes'
import { registerMetricsWorkers } from './metrics.workers'
import { MetricsQueries } from './services/metrics-queries'

const DAY_MS = 24 * 60 * 60_000

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/**
 * How many times each event of each application was told, minute by minute: collected
 * from it every minute, kept in a DuckDB of its own, summed by day, and forgotten as
 * its retention says.
 */
export class Metrics_Module extends Module {

  static initialize(base: MonitorBase, deps: Metrics_Deps, options: Metrics_Options): Metrics_Module {
    const module = new Metrics_Module(base, new MetricsFeed_Repository(base), deps, options)
    registerMetricsRoutes(base, module)
    registerMetricsWorkers(module, deps)
    return module
  }

  /** Every minute: what each application watched has closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: MetricsFeed_Repository, private readonly deps: Metrics_Deps, private readonly options: Metrics_Options) {
    super('metrics', base.invocations, deps)
    this.minutely = base.schedules.define('metrics.minutely', '* * * * *')
    this.nightly = base.schedules.define('metrics.nightly', '30 3 * * *')
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
    const feed = await this.feedOf(appId)
    const read = await this.deps.connection.fetchMetrics(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    await this.options.store.append(appId, read.value.counts)
    feed.collectedUntil(read.value.until)
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
    const feed = await this.feedOf(appId)
    const at = now()
    const { minuteDays, dayDays } = feed.retention
    await this.options.store.summarize(appId, dayBefore(at, 1))
    await this.options.store.forget(appId, new Date(at.getTime() - minuteDays * DAY_MS).toISOString(), dayDays === null ? null : dayBefore(at, dayDays))
  }

  /** Keeps every application's metrics, archived ones too: their retention runs all the same. */
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

  /** How long its metrics are kept. */
  @UseCase()
  async retention(appId: string): Promise<MetricsRetentionDTO> {
    await this.deps.app.get(appId)
    return (await this.feedOf(appId)).retention
  }

  /** Changes how long its metrics are kept: what is older goes at the next nightly keep. */
  @UseCase()
  async changeRetention(appId: string, input: unknown): Promise<MetricsRetentionDTO> {
    await this.deps.app.get(appId)
    const change = MetricsRetentionSchema.parse(input)
    const feed = await this.feedOf(appId)
    feed.keep(change)
    await this.repo.persist(feed)
    return feed.retention
  }

  /** Forgets everything of an application deleted: its feed, and its DuckDB. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    await this.options.store.drop(appId)
  }

  private async queries(appId: string): Promise<MetricsQueries> {
    return new MetricsQueries(await this.options.store.of(appId))
  }

  /** Its feed, started with the retention by default the first time. */
  private async feedOf(appId: string): Promise<MetricsFeed> {
    return await this.repo.first({ appId }) ?? MetricsFeed.start(appId)
  }
}
