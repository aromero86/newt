import type { Migrations } from './migrations'
import type { Outbox } from '../port-outbox'
import type { StoredRow } from './stored-row'
import type { Table } from './table'
import type { TableOptions } from './table-options'

/**
 * Where a context keeps its data: the port every storage adapter implements. The
 * framework needs only this of it; the context's repositories may use the adapter's
 * own API too (its connection, its collections) for what a `Table` cannot say.
 *
 * What every adapter promises:
 * - **A transaction is all or nothing.** What `transaction` writes, its outbox jobs
 *   included, is stored together or not at all. A call inside one joins it: there
 *   is only ever the outermost.
 * - **The current transaction follows the code.** Whatever runs inside `fn`, however
 *   deep and across `await`s, reads and writes in it, without being handed it.
 * - **Transactions that guard the same key never interleave.** A rule over several
 *   rows (the stock of a product, the admins of a workspace) names what it guards
 *   (`guard(['stock:<id>'])`); while one transaction holds a key, another that asks
 *   for it waits, so what the rule reads stays true until it commits. Stores that run
 *   one transaction at a time (SQLite, files) keep it already; one with concurrent
 *   transactions takes a lock for each key (an advisory lock).
 * - **Reads outside a transaction see only what is committed.**
 * - **A stored row keeps its version**, and a write that finds another (someone saved
 *   it since it was read), or a new row whose key or unique value is taken, throws
 *   `ConcurrencyConflict`.
 *
 * `@newt-kit/newt/port-store/contract` has the suite that checks an adapter keeps every promise.
 */
export interface Store {
  /** Runs `fn` in a transaction, or in the one in progress; resolves once it commits. */
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  /**
   * Holds these keys until the transaction in progress ends: no other transaction that
   * guards one of them runs in between. Only inside a transaction.
   */
  guard(keys: string[]): Promise<void>
  /** Runs `fn` once the transaction in progress commits; at once outside one; never if it rolls back. */
  afterCommit(fn: () => void): void
  /** Runs `fn` if the transaction in progress rolls back, latest first; never outside one. */
  afterRollback(fn: () => void): void
  /** One of its tables, of rows with an id and a version: what `TableRepository` works on. */
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  /** Where the jobs of `handler` subscriptions are written, in the transaction of the change that publishes them. */
  readonly outbox: Outbox
  /** The changes to its structure, applied in order. */
  readonly migrations: Migrations
  close(): Promise<void>
}
