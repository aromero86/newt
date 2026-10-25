import type { ReservedSQL } from 'bun'
import type { SqlDialect } from './sql-dialect'

/** What a database server's dialect adds, for a store on a pool of connections (Postgres, MySQL). */
export type SqlServerDialect = SqlDialect & {
  /** Its name in a URL, and in its migrations folder: `postgres`, `mysql`. */
  name: 'postgres' | 'mysql'
  begin: string
  /** Whether a statement that fails spoils the transaction it is in, so a write that may fail needs a savepoint. */
  failedStatementAborts: boolean
  /** How many rows a write changed, as its driver tells. */
  changed(result: unknown): number
  /** Holds these keys, sorted, until the transaction on `connection` ends; then `release` lets go of them, if the database does not on its own. */
  lock(connection: ReservedSQL, keys: string[], waitMs: number): Promise<void>
  release(connection: ReservedSQL): Promise<void>
  /** Claims jobs of an outbox: up to `limit` ready ones of these queues, each one for this worker, one attempt on. */
  claim(run: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>, queues: string[], limit: number, worker: string, leaseUntil: string, now: string): Promise<Record<string, unknown>[]>
  /** Registers queues as seen: inserted, or brought up to date. */
  upsertQueue: string
}
