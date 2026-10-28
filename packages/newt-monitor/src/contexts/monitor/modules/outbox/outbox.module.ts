import type { DeadJobs, OutboxState } from 'newt/contract'
import { Module, now, UseCase } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { BUCKETS, DEFAULT_BUCKET, WINDOWS } from '../event-metrics/event-metrics.schema'
import { DeadJobsQuerySchema, DepthQuerySchema, type DepthPointDTO, type DepthSeriesDTO, type OutboxNowDTO, type OutboxQueueDTO, type SnapshotDTO } from './outbox.schema'
import { OutboxUnreachable } from './errors/outbox-unreachable'
import type { Outbox_Deps } from './outbox.deps'
import type { Outbox_Options } from './outbox-options'
import { registerOutboxRoutes } from './outbox.routes'
import { registerOutboxWorkers } from './outbox.workers'

const DAY_MS = 24 * 60 * 60_000

/**
 * How full each application's queues are: a snapshot every minute, as a broker's
 * dashboard shows it (ready, retrying, running, dead, how long the oldest waits, and
 * which no worker serves), kept in its DuckDB as the depth's history; and its dead
 * jobs, asked of it as someone looks.
 */
export class Outbox_Module extends Module {

  static initialize(base: MonitorBase, deps: Outbox_Deps, options: Outbox_Options): Outbox_Module {
    options.store.define({
      queue_depth: { columns: { minute: 'TIMESTAMP', context: 'VARCHAR', queue: 'VARCHAR', ready: 'INTEGER', retrying: 'INTEGER', running: 'INTEGER', dead: 'INTEGER', oldest_wait_ms: 'DOUBLE', orphan: 'BOOLEAN' } },
    })
    const module = new Outbox_Module(base, deps, options)
    registerOutboxRoutes(base, module)
    registerOutboxWorkers(module, deps)
    return module
  }

  /** Every minute: a snapshot of each application watched. */
  readonly minutely
  /** Every night: the snapshots its retention says are old forgotten. */
  readonly nightly

  private constructor(base: MonitorBase, private readonly deps: Outbox_Deps, private readonly options: Outbox_Options) {
    super('outbox', base.invocations, deps)
    this.minutely = base.schedules.define('outbox.minutely', '* * * * *')
    this.nightly = base.schedules.define('outbox.nightly', '0 4 * * *')
  }

  /** Asks the application how full its queues are, and keeps it as this minute's snapshot. */
  // Asking the application records, in `connection`, whether it answered: as `structure.refresh` does.
  @UseCase({ writesTo: ['connection'] })
  async snapshot(appId: string): Promise<SnapshotDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone' }
    if (app.archivedAt !== null) return { appId, outcome: 'archived' }
    const read = await this.deps.connection.fetchOutbox(appId)
    if (!read.answered) return { appId, outcome: 'unreachable' }
    const queues = await this.keepSnapshot(appId, read.value)
    return { appId, outcome: 'taken', queues, at: read.value.at }
  }

  /** A snapshot of every application watched, one after another. */
  @UseCase({ writesTo: ['connection'] })
  async snapshotAll(): Promise<SnapshotDTO[]> {
    const taken: SnapshotDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) taken.push(await this.snapshot(appId))
    return taken
  }

  /** Forgets the snapshots its retention says are old: they are kept as its minutes are. */
  @UseCase()
  async keep(appId: string): Promise<void> {
    const { minuteDays } = await this.deps.retention.of(appId)
    await (await this.options.store.of(appId)).run('DELETE FROM queue_depth WHERE minute < CAST($1 AS TIMESTAMP)', [new Date(now().getTime() - minuteDays * DAY_MS).toISOString()])
  }

  /** Keeps every application's snapshots, archived ones too. */
  @UseCase()
  async keepAll(): Promise<void> {
    for (const appId of await this.deps.app.allIds()) await this.keep(appId)
  }

  /** Its queues as the last snapshot found them. */
  @UseCase()
  async now(appId: string): Promise<OutboxNowDTO> {
    await this.deps.app.get(appId)
    const rows = await (await this.options.store.of(appId)).query<{ minute: string, context: string, queue: string, ready: number, retrying: number, running: number, dead: number, oldest_wait_ms: number | null, orphan: boolean }>(
      'SELECT * FROM queue_depth WHERE minute = (SELECT max(minute) FROM queue_depth) ORDER BY context, queue')
    return {
      at: rows[0]?.minute ?? null,
      queues: rows.map((row): OutboxQueueDTO => ({
        context: row.context, queue: row.queue, ready: row.ready, retrying: row.retrying, running: row.running, dead: row.dead, oldestWaitMs: row.oldest_wait_ms, orphan: row.orphan,
      })),
    }
  }

  /** A queue's depth over a window: the most each kind of job reached in each bucket. */
  @UseCase()
  async depth(appId: string, input: unknown): Promise<DepthSeriesDTO> {
    await this.deps.app.get(appId)
    const query = DepthQuerySchema.parse(input)
    const bucket = query.bucket ?? DEFAULT_BUCKET[query.window]
    const size = BUCKETS[bucket]
    const seconds = size / 1000
    const at = now().getTime()
    const to = at - (at % size) + size
    const from = to - WINDOWS[query.window].ms
    const rows = await (await this.options.store.of(appId)).query<{ slot: number, ready: number, retrying: number, running: number, dead: number }>(`
      SELECT slot, sum(ready) AS ready, sum(retrying) AS retrying, sum(running) AS running, sum(dead) AS dead FROM (
        SELECT CAST(floor(epoch(minute) / ${seconds}) * ${seconds} AS BIGINT) AS slot, context, queue, max(ready) AS ready, max(retrying) AS retrying, max(running) AS running, max(dead) AS dead
        FROM queue_depth WHERE minute >= CAST($1 AS TIMESTAMP) AND minute < CAST($2 AS TIMESTAMP) AND (CAST($3 AS VARCHAR) IS NULL OR context = $3) AND (CAST($4 AS VARCHAR) IS NULL OR queue = $4)
        GROUP BY slot, context, queue
      ) GROUP BY slot`,
    [new Date(from).toISOString(), new Date(to).toISOString(), query.context ?? null, query.queue ?? null])
    const bySlot = new Map(rows.map(row => [row.slot * 1000, row]))
    const points: DepthPointDTO[] = []
    for (let slot = from; slot < to; slot += size) {
      const row = bySlot.get(slot)
      points.push({ at: new Date(slot).toISOString(), ready: row?.ready ?? null, retrying: row?.retrying ?? null, running: row?.running ?? null, dead: row?.dead ?? null })
    }
    return { window: query.window, bucket, from: new Date(from).toISOString(), to: new Date(to).toISOString(), points }
  }

  /** A page of a context's dead jobs, asked of the application as someone looks: never their payloads. */
  @UseCase()
  async deadJobs(appId: string, input: unknown): Promise<DeadJobs> {
    await this.deps.app.get(appId)
    const query = DeadJobsQuerySchema.parse(input)
    const read = await this.deps.connection.fetchDeadJobs(appId, query.context, query.after ?? null, query.limit)
    if (!read.answered) throw new OutboxUnreachable(read.failure.message)
    return read.value
  }

  /** Forgets everything of an application deleted: its snapshots; its DuckDB too, once nothing else is in it. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await (await this.options.store.of(appId)).run('DELETE FROM queue_depth')
    await this.options.store.dropIfEmpty(appId)
  }

  /** Each queue of a snapshot, a row of its minute; how many. */
  private async keepSnapshot(appId: string, state: OutboxState): Promise<number> {
    const at = Date.parse(state.at)
    const minute = new Date(at - (at % 60_000)).toISOString()
    const rows = state.contexts.flatMap(({ context, queues }) => queues.map(queue => ({
      id: `${minute}|${context}|${queue.queue}`, minute, context, queue: queue.queue,
      ready: queue.ready, retrying: queue.retrying, running: queue.running, dead: queue.dead,
      oldest_wait_ms: queue.oldestDueAt === null ? null : Math.max(0, at - Date.parse(queue.oldestDueAt)), orphan: queue.orphan,
    })))
    await (await this.options.store.of(appId)).append('queue_depth', rows)
    return rows.length
  }
}
