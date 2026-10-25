import type { SQLQueryBindings } from 'bun:sqlite'
import type { Job, JobClosing, JobQueueRegistration, Outbox } from '../port-outbox'
import type { SqliteStore } from './sqlite-store'

type JobRow = {
  id: string
  queue: string
  event: string
  status: Job['status']
  attempts: number
  run_after: string
  locked_by: string | null
  locked_until: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, queue, event, status, attempts, run_after, locked_by, locked_until, last_error, created_at, updated_at'

/** The outbox in SQLite: the `job` and `job_queue` tables, which the store migrates itself. */
export class SqliteOutbox implements Outbox {

  constructor(private readonly store: SqliteStore) {}

  add(jobs: Job[]): Promise<void> {
    return this.store.transaction(() => {
      const insert = this.store.connection.prepare(`INSERT INTO job (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const job of jobs) {
        insert.run(job.id, job.queue, job.event, job.status, job.attempts, job.runAfter, job.lockedBy, job.lockedUntil, job.lastError, job.createdAt, job.updatedAt)
      }
    })
  }

  /** One statement, so no other worker can claim the same job. */
  claim(queues: string[], limit: number, worker: string, leaseUntil: string): Promise<Job[]> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      const rows = this.store.connection.prepare(`
        UPDATE job SET status = 'running', locked_by = ?, locked_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id IN (
          SELECT id FROM job
          WHERE queue IN (${queues.map(() => '?').join(', ')})
            AND ((status = 'pending' AND run_after <= ?) OR (status = 'running' AND locked_until < ?))
          ORDER BY run_after
          LIMIT ?
        )
        RETURNING ${COLUMNS}`).all(worker, leaseUntil, now, ...queues, now, now, limit) as JobRow[]
      return rows.map(toJob)
    })
  }

  renew(claimed: Job, leaseUntil: string): Promise<void> {
    return this.onClaim(claimed, 'locked_until = ?, updated_at = ?', [leaseUntil, new Date().toISOString()])
  }

  close(claimed: Job, closing: JobClosing): Promise<void> {
    const runAfter = closing.runAfter ?? null
    return this.onClaim(
      claimed,
      'status = ?, last_error = ?, run_after = coalesce(?, run_after), locked_by = NULL, locked_until = NULL, updated_at = ?',
      [closing.status, closing.lastError, runAfter, new Date().toISOString()],
    )
  }

  seen(queues: JobQueueRegistration[]): Promise<void> {
    const now = new Date().toISOString()
    return this.store.transaction(() => {
      const upsert = this.store.connection.prepare(`
        INSERT INTO job_queue (name, event, attempts, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (name) DO UPDATE SET event = excluded.event, attempts = excluded.attempts, last_seen_at = excluded.last_seen_at`)
      for (const queue of queues) upsert.run(queue.name, queue.event, queue.attempts, now, now)
    })
  }

  purge(before: string): Promise<void> {
    return this.store.transaction(() => {
      this.store.connection.prepare(`DELETE FROM job WHERE status = 'done' AND updated_at < ?`).run(before)
    })
  }

  async list(): Promise<Job[]> {
    return (this.store.connection.prepare(`SELECT ${COLUMNS} FROM job ORDER BY created_at, id`).all() as JobRow[]).map(toJob)
  }

  async queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]> {
    return this.store.connection.prepare('SELECT name, event, attempts, last_seen_at AS lastSeenAt FROM job_queue ORDER BY name').all() as (JobQueueRegistration & { lastSeenAt: string })[]
  }

  /** A write on a claimed job, only while it is still the claim it was: see `isSameClaim`. */
  private onClaim(claimed: Job, set: string, params: SQLQueryBindings[]): Promise<void> {
    return this.store.transaction(() => {
      this.store.connection
        .prepare(`UPDATE job SET ${set} WHERE id = ? AND status = 'running' AND attempts = ?`)
        .run(...params, claimed.id, claimed.attempts)
    })
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    queue: row.queue,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    runAfter: row.run_after,
    lockedBy: row.locked_by,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
