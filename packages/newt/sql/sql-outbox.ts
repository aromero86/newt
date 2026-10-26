import type { Job, JobClosing, JobQueueRegistration, Outbox } from '../port-outbox'
import type { SqlServerDialect } from './sql-server-dialect'

const COLUMNS = ['id', 'queue', 'event', 'status', 'attempts', 'run_after', 'locked_by', 'locked_until', 'last_error', 'created_at', 'updated_at']

type Run = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

/** The outbox of a store on a database server: the `job` and `job_queue` tables, which the store migrates itself. */
export class SqlOutbox implements Outbox {

  constructor(
    private readonly dialect: SqlServerDialect,
    private readonly transaction: <T>(fn: (run: Run) => Promise<T>) => Promise<T>,
    private readonly read: Run,
  ) {}

  add(jobs: Job[]): Promise<void> {
    return this.transaction(async run => {
      const placeholders = COLUMNS.map((_, i) => this.dialect.param(i + 1)).join(', ')
      for (const job of jobs) {
        await run(`INSERT INTO job (${COLUMNS.join(', ')}) VALUES (${placeholders})`, [job.id, job.queue, job.event, job.status, job.attempts, job.runAfter, job.lockedBy, job.lockedUntil, job.lastError, job.createdAt, job.updatedAt])
      }
    })
  }

  claim(queues: string[], limit: number, worker: string, leaseUntil: string): Promise<Job[]> {
    return this.transaction(async run => (await this.dialect.claim(run, queues, limit, worker, leaseUntil, new Date().toISOString())).map(toJob))
  }

  renew(claimed: Job, leaseUntil: string): Promise<void> {
    return this.onClaim(claimed, ['locked_until'], [leaseUntil])
  }

  close(claimed: Job, closing: JobClosing): Promise<void> {
    return closing.runAfter
      ? this.onClaim(claimed, ['status', 'last_error', 'run_after', 'locked_by', 'locked_until'], [closing.status, closing.lastError, closing.runAfter, null, null])
      : this.onClaim(claimed, ['status', 'last_error', 'locked_by', 'locked_until'], [closing.status, closing.lastError, null, null])
  }

  retry(id: string): Promise<boolean> {
    const now = new Date().toISOString()
    return this.transaction(async run => {
      // Locked as it is read, so no other retry nor claim slips in before the update.
      const [dead] = await run(`SELECT id FROM job WHERE id = ${this.dialect.param(1)} AND status = 'dead' FOR UPDATE`, [id])
      if (!dead) return false
      await run(`UPDATE job SET status = 'pending', attempts = 0, run_after = ${this.dialect.param(1)}, locked_by = NULL, locked_until = NULL, updated_at = ${this.dialect.param(2)} WHERE id = ${this.dialect.param(3)} AND status = 'dead'`, [now, now, id])
      return true
    })
  }

  seen(queues: JobQueueRegistration[]): Promise<void> {
    const now = new Date().toISOString()
    return this.transaction(async run => {
      for (const queue of queues) await run(this.dialect.upsertQueue, [queue.name, queue.event, queue.attempts, now, now])
    })
  }

  purge(before: string): Promise<void> {
    return this.transaction(async run => {
      await run(`DELETE FROM job WHERE status = 'done' AND updated_at < ${this.dialect.param(1)}`, [before])
    })
  }

  async list(): Promise<Job[]> {
    return (await this.read(`SELECT ${COLUMNS.join(', ')} FROM job ORDER BY created_at, id`)).map(toJob)
  }

  async waiting(): Promise<{ queue: string, jobs: number }[]> {
    const rows = await this.read(`SELECT queue, COUNT(*) AS jobs FROM job WHERE status IN ('pending', 'running') GROUP BY queue ORDER BY queue`)
    return rows.map(row => ({ queue: String(row.queue), jobs: Number(row.jobs) }))
  }

  async queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]> {
    const rows = await this.read('SELECT name, event, attempts, last_seen_at FROM job_queue ORDER BY name')
    return rows.map(row => ({ name: String(row.name), event: String(row.event), attempts: Number(row.attempts), lastSeenAt: String(row.last_seen_at) }))
  }

  /** A write on a claimed job, only while it is still the claim it was: see `isSameClaim`. */
  private onClaim(claimed: Job, columns: string[], values: unknown[]): Promise<void> {
    const sets = [...columns, 'updated_at'].map((column, i) => `${column} = ${this.dialect.param(i + 1)}`).join(', ')
    const n = columns.length + 1
    return this.transaction(async run => {
      await run(`UPDATE job SET ${sets} WHERE id = ${this.dialect.param(n + 1)} AND status = 'running' AND attempts = ${this.dialect.param(n + 2)}`, [...values, new Date().toISOString(), claimed.id, claimed.attempts])
    })
  }
}

function toJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    queue: String(row.queue),
    event: String(row.event),
    status: row.status as Job['status'],
    attempts: Number(row.attempts),
    runAfter: String(row.run_after),
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedUntil: (row.locked_until as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
