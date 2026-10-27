import type { Trace } from 'newt/contract'
import { Module, now, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { TraceListQuerySchema, TraceNotFound, TracesFeed, type CollectTracesDTO, type TraceDTO, type TraceListDTO } from './traces'
import type { Traces_Deps } from './traces.deps'
import type { Traces_Options } from './traces-options'
import { TracesFeed_Repository } from './traces.repository'
import { registerTracesRoutes } from './traces.routes'
import { registerTracesWorkers } from './traces.workers'
import { TracesQueries } from './services/traces-queries'

const DAY_MS = 24 * 60 * 60_000

/**
 * The traces each application kept: its requests and jobs that went wrong or ran
 * again, and a share of the rest, each a tree of its use cases, their runs and their
 * queries. Collected every minute into its DuckDB, with each call and each event told
 * apart, to find them by; forgotten as its retention says.
 */
export class Traces_Module extends Module {

  static initialize(base: MonitorBase, deps: Traces_Deps, options: Traces_Options): Traces_Module {
    options.store.define({
      traces: {
        columns: {
          started_at: 'TIMESTAMP', kind: 'VARCHAR', name: 'VARCHAR', ms: 'DOUBLE', outcome_kind: 'VARCHAR', outcome_code: 'VARCHAR', retried: 'BOOLEAN',
          actor: 'VARCHAR', use_cases: 'JSON', job_id: 'VARCHAR', job_queue: 'VARCHAR', job_run: 'INTEGER', event_id: 'VARCHAR', body: 'JSON',
        },
      },
      trace_call: { columns: { trace_id: 'VARCHAR', started_at: 'TIMESTAMP', context: 'VARCHAR', use_case: 'VARCHAR', ms: 'DOUBLE', outcome_kind: 'VARCHAR' } },
      trace_told: { columns: { trace_id: 'VARCHAR', started_at: 'TIMESTAMP', event_id: 'VARCHAR' } },
    })
    const module = new Traces_Module(base, new TracesFeed_Repository(base), deps, options)
    registerTracesRoutes(base, module)
    registerTracesWorkers(module, deps)
    return module
  }

  /** Every minute: the traces each application watched kept since its last collection. */
  readonly minutely
  /** Every night: what is old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly repo: TracesFeed_Repository, private readonly deps: Traces_Deps, private readonly options: Traces_Options) {
    super('traces', base.invocations, deps)
    this.minutely = base.schedules.define('traces.minutely', '* * * * *')
    this.nightly = base.schedules.define('traces.nightly', '50 3 * * *')
  }

  /** Asks the application for the traces it kept since the last collection, a page at a time, and keeps them. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async collect(appId: string): Promise<CollectTracesDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const feed = await this.repo.first({ appId }) ?? TracesFeed.start(appId)
    let traces = 0
    // Pages until it says nothing more is closed: a page ends at a whole minute.
    for (;;) {
      const read = await this.deps.connection.fetchTraces(appId, feed.until)
      if (!read.answered) return traces ? { appId, outcome: 'collected', traces, until: feed.until! } : { appId, outcome: 'unreachable' }
      await this.append(appId, read.value.traces)
      traces += read.value.traces.length
      const moved = feed.until !== read.value.until
      feed.collectedUntil(read.value.until)
      await this.repo.persist(feed)
      if (!moved || read.value.traces.length === 0) return { appId, outcome: 'collected', traces, until: read.value.until }
    }
  }

  /** Collects every application watched, one after another: one that does not answer is recorded so. */
  @UseCase({ writesTo: ['connection'] })
  async collectAll(): Promise<CollectTracesDTO[]> {
    const collected: CollectTracesDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) collected.push(await this.collect(appId))
    return collected
  }

  /** Forgets the traces its retention says are old. */
  @UseCase()
  async keep(appId: string): Promise<void> {
    const { traceDays } = await this.deps.retention.of(appId)
    const before = new Date(now().getTime() - traceDays * DAY_MS).toISOString()
    const analytics = await this.options.store.of(appId)
    for (const table of ['traces', 'trace_call', 'trace_told']) await analytics.run(`DELETE FROM ${table} WHERE started_at < CAST($1 AS TIMESTAMP)`, [before])
  }

  /** Keeps every application's traces, archived ones too: their retention runs all the same. */
  @UseCase()
  async keepAll(): Promise<void> {
    for (const feed of await this.repo.find({})) await this.keep(feed.appId)
  }

  /** Its traces in a window, by what they did and how they went. */
  @UseCase()
  async list(appId: string, input: unknown): Promise<TraceListDTO> {
    await this.deps.app.get(appId)
    return (await this.queries(appId)).list(TraceListQuerySchema.parse(input), now())
  }

  /** One of its traces, whole, with what it is linked to. */
  @UseCase()
  async get(appId: string, traceId: string): Promise<TraceDTO> {
    await this.deps.app.get(appId)
    const trace = await (await this.queries(appId)).get(traceId)
    if (!trace) throw new TraceNotFound(traceId)
    return trace
  }

  /** Forgets everything of an application deleted: its feed, and its rows; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
    const analytics = await this.options.store.of(appId)
    for (const table of ['traces', 'trace_call', 'trace_told']) await analytics.run(`DELETE FROM ${table}`)
    await this.options.store.dropIfEmpty(appId)
  }

  /** Each trace a row, each of its calls and each event it told one more: what it is found by. */
  private async append(appId: string, traces: Trace[]): Promise<void> {
    const analytics = await this.options.store.of(appId)
    await analytics.append('traces', traces.map(trace => ({
      id: trace.id, started_at: trace.startedAt, kind: trace.kind, name: trace.name, ms: trace.ms,
      outcome_kind: trace.outcome?.kind ?? null, outcome_code: trace.outcome?.code ?? null, retried: trace.retried, actor: trace.actor,
      use_cases: trace.useCases, job_id: trace.job?.id ?? null, job_queue: trace.job?.queue ?? null, job_run: trace.job?.run ?? null, event_id: trace.job?.eventId ?? null,
      body: trace,
    })))
    await analytics.append('trace_call', traces.flatMap(trace => trace.spans.filter(span => span.kind === 'use-case').map(span => ({
      id: `${trace.id}|${span.id}`, trace_id: trace.id, started_at: trace.startedAt, context: span.context, use_case: span.name, ms: span.ms, outcome_kind: span.outcome?.kind ?? null,
    }))))
    await analytics.append('trace_told', traces.flatMap(trace => trace.told.map(eventId => ({ id: `${trace.id}|${eventId}`, trace_id: trace.id, started_at: trace.startedAt, event_id: eventId }))))
  }

  private async queries(appId: string): Promise<TracesQueries> {
    return new TracesQueries(await this.options.store.of(appId))
  }
}
