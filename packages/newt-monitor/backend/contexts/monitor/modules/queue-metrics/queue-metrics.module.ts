import type { QueueFlow } from '@newt-kit/newt/contract'
import { Module, now, UseCase } from '@newt-kit/newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { eachApp } from '../../../../shared/each-app'
import { AppGone } from '../../../../shared/metrics-store/metrics-store'
import { DEFAULT_BUCKET } from '../event-metrics/event-metrics.schema'
import { QueueMetricsFeed, QueueSeriesQuerySchema, QueueTotalsQuerySchema, type CollectFlowsDTO, type QueueSeriesDTO, type QueueTotalDTO } from './queue-metrics'
import type { QueueMetrics_Deps } from './queue-metrics.deps'
import type { QueueMetrics_Options } from './queue-metrics-options'
import { QueueMetricsFeed_Repository } from './queue-metrics.repository'
import { registerQueueMetricsRoutes } from './queue-metrics.routes'
import { registerQueueMetricsWorkers } from './queue-metrics.workers'
import { QueueMetricsQueries } from './services/queue-metrics-queries'

const DAY_MS = 24 * 60 * 60_000

/** A day, `days` before a time, as `YYYY-MM-DD`. */
const dayBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10)

/**
 * How each queue of each application flows, as a broker would say it: jobs published,
 * delivered, redelivered and dead, and how long they waited in it. Collected every
 * minute into its DuckDB, summed by day, forgotten as its retention says. What the
 * handlers did is their use cases' metrics.
 */
export class QueueMetrics_Module extends Module {

  static initialize(base: MonitorBase, deps: QueueMetrics_Deps, options: QueueMetrics_Options): QueueMetrics_Module {
    const counts = { published: 'INTEGER', delivered: 'INTEGER', redelivered: 'INTEGER', dead: 'INTEGER' } as const
    options.store.define({
      queue_minute: { columns: { minute: 'TIMESTAMP', context: 'VARCHAR', queue: 'VARCHAR', ...counts } },
      queue_minute_wait: { columns: { minute: 'TIMESTAMP', context: 'VARCHAR', queue: 'VARCHAR', bucket: 'INTEGER', count: 'INTEGER' } },
      queue_day: { columns: { day: 'DATE', context: 'VARCHAR', queue: 'VARCHAR', published: 'BIGINT', delivered: 'BIGINT', redelivered: 'BIGINT', dead: 'BIGINT' } },
      queue_day_wait: { columns: { day: 'DATE', context: 'VARCHAR', queue: 'VARCHAR', bucket: 'INTEGER', count: 'BIGINT' } },
    })
    const module = new QueueMetrics_Module(base, new QueueMetricsFeed_Repository(base), deps, options)
    registerQueueMetricsRoutes(base, module)
    registerQueueMetricsWorkers(module, deps)
    return module
  }

  /** Every minute: what each application watched has closed since its last collection. */
  readonly minutely
  /** Every night: the days summed, and what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: QueueMetricsFeed_Repository, private readonly deps: QueueMetrics_Deps, private readonly options: QueueMetrics_Options) {
    super('queueMetrics', base.invocations, deps)
    this.minutely = base.schedules.define('queueMetrics.minutely', '* * * * *')
    this.nightly = base.schedules.define('queueMetrics.nightly', '55 3 * * *')
  }

  /** Asks the application how its queues flowed in the minutes closed since the last collection, and keeps it. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectFlowsDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.repo.first({ appId }) ?? QueueMetricsFeed.start(appId)
    const read = await this.deps.connection.fetchFlows(appId, feed.until)
    if (!read.answered) return { appId, outcome: 'unreachable' }

    // Deleted while it was asked: what it answered is not kept, nor its DuckDB opened again.
    if (!await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    try {
      await this.append(appId, read.value.flows)
    } catch (error) {
      if (error instanceof AppGone) return { appId, outcome: 'gone' }
      throw error
    }
    feed.collectedUntil(read.value.until)
    // A first feed is kept only for an application still there.
    if (feed.isNew && !await this.deps.app.find(appId)) return { appId, outcome: 'gone' }
    await this.repo.persist(feed)
    return { appId, outcome: 'collected', flows: read.value.flows.length, until: read.value.until }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so, one that fails too, and the others go on. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectFlowsDTO[]> {
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
    const day = `strftime(CAST(minute AS DATE), '%Y-%m-%d') || '|' || context || '|' || queue`
    await analytics.run(`
      INSERT INTO queue_day (id, day, context, queue, published, delivered, redelivered, dead)
      SELECT ${day}, CAST(minute AS DATE), context, queue, sum(published), sum(delivered), sum(redelivered), sum(dead)
      FROM queue_minute WHERE minute < CAST($1 AS DATE) GROUP BY CAST(minute AS DATE), context, queue
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    await analytics.run(`
      INSERT INTO queue_day_wait (id, day, context, queue, bucket, count)
      SELECT ${day} || '|' || bucket, CAST(minute AS DATE), context, queue, bucket, sum(count)
      FROM queue_minute_wait WHERE minute < CAST($1 AS DATE) GROUP BY CAST(minute AS DATE), context, queue, bucket
      ON CONFLICT DO NOTHING`, [dayBefore(at, 1)])
    const minutesBefore = new Date(at.getTime() - minuteDays * DAY_MS).toISOString()
    for (const table of ['queue_minute', 'queue_minute_wait']) await analytics.run(`DELETE FROM ${table} WHERE minute < CAST($1 AS TIMESTAMP)`, [minutesBefore])
    if (dayDays !== null) {
      for (const table of ['queue_day', 'queue_day_wait']) await analytics.run(`DELETE FROM ${table} WHERE day < CAST($1 AS DATE)`, [dayBefore(at, dayDays)])
    }
  }

  /** Keeps every application's queue flows, archived ones too: their retention runs all the same, and one that fails keeps none of the others from it. */
  @UseCase()
  async keepAll(): Promise<void> {
    await eachApp((await this.repo.find({})).map(feed => feed.appId), appId => this.keep(appId), () => undefined)
  }

  /** Each of its queues' flow in a window, beside the window before: the busiest first. */
  @UseCase()
  async totals(appId: string, input: unknown): Promise<QueueTotalDTO[]> {
    await this.deps.app.get(appId)
    const { window } = QueueTotalsQuerySchema.parse(input)
    return (await this.queries(appId)).totals(window, now())
  }

  /** A queue's flow in a window, by bucket, beside the window it is compared with. */
  @UseCase()
  async series(appId: string, input: unknown): Promise<QueueSeriesDTO> {
    await this.deps.app.get(appId)
    const query = QueueSeriesQuerySchema.parse(input)
    return (await this.queries(appId)).series(query.context, query.queue, query.window, query.bucket ?? DEFAULT_BUCKET[query.window], query.compare, now())
  }

  /** Forgets everything of an application deleted: its feed, and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.ofUnlessDropped(appId)
    // Another module dropped its DuckDB already: nothing of it is left.
    if (!analytics) return
    for (const table of ['queue_minute', 'queue_minute_wait', 'queue_day', 'queue_day_wait']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  private async append(appId: string, flows: QueueFlow[]): Promise<void> {
    const analytics = await this.options.store.of(appId)
    const rows = flows.map(flow => {
      const id = `${flow.minute}|${flow.context}|${flow.queue}`
      const row = { minute: flow.minute, context: flow.context, queue: flow.queue }
      return {
        minute: { id, ...row, published: flow.published, delivered: flow.delivered, redelivered: flow.redelivered, dead: flow.dead },
        wait: Object.entries(flow.wait).map(([bucket, count]) => ({ id: `${id}|${bucket}`, ...row, bucket: Number(bucket), count })),
      }
    })
    await analytics.append('queue_minute', rows.map(row => row.minute))
    await analytics.append('queue_minute_wait', rows.flatMap(row => row.wait))
  }

  private async queries(appId: string): Promise<QueueMetricsQueries> {
    return new QueueMetricsQueries(await this.options.store.of(appId))
  }
}
