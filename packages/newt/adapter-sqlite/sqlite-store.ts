import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { TransactionScope, type Migrations, type Store, type StoredRow, type TableOptions } from '../port-store'
import { isCollision } from './is-collision'
import type { SqlExecutor } from '../sql'
import { MigrationRunner } from './migration-runner'
import { SqliteOutbox } from './sqlite-outbox'
import type { SqliteStoreOptions } from './sqlite-store-options'
import { SqliteTable } from './sqlite-table'
import type { SqliteTableOptions } from './sqlite-table-options'

/**
 * A statement that changes rows or structure: refused outside a transaction, with a
 * clear error. A `with` is a read unless what follows its common table expressions writes.
 */
const WRITE = /^\s*(insert|update|delete|replace|create|drop|alter|analyze|reindex)\b|^\s*with\b[\s\S]*\)\s*(insert|update|delete|replace)\b/i

/**
 * The SQLite store, on `bun:sqlite`.
 *
 * Transactions run one at a time, in the order they ask, on a connection that writes;
 * reads outside them go to a second connection, read only, which sees only what is
 * committed (WAL). Inside a transaction everything goes to the writing one, so it
 * reads what it wrote. `connection` is the handle for all of it: each statement runs
 * on the right connection when it runs (not when it was prepared), and a write
 * outside a transaction is refused.
 *
 * A repository that wants a query builder puts it on `connection`: `kyselyFor(store)`
 * does, and so may any that takes a `bun:sqlite` database, so long as its
 * transactions are `store.transaction`, never its own.
 */
export class SqliteStore implements Store {

  readonly outbox: SqliteOutbox
  readonly migrations: Migrations
  /** Statements run on the right connection on their own: see the class. */
  readonly connection: Database

  private readonly scope: TransactionScope

  private constructor(
    private readonly writer: Database,
    private readonly reader: Database,
    private readonly temporary: string | null,
    options: SqliteStoreOptions,
  ) {
    this.scope = new TransactionScope(options.waitTimeoutMs)
    this.connection = this.routedConnection()
    this.outbox = new SqliteOutbox(this)
    const own = new MigrationRunner(writer, options.migrations)
    const framework = new MigrationRunner(writer, join(import.meta.dir, 'migrations'), 'framework_migrations')
    this.migrations = {
      // Its own, then the framework's (its outbox), as `open` does.
      up: () => this.scope.exclusive(async () => {
        const applied = await own.up()
        await framework.up()
        return applied
      }),
      down: () => this.scope.exclusive(() => own.down()),
      status: () => own.status(),
    }
  }

  /** Opens a store and brings it up to date: its own migrations, then the framework's (its outbox). */
  static async open(options: SqliteStoreOptions): Promise<SqliteStore> {
    const store = await SqliteStore.connect(options)
    try {
      await store.migrations.up()
    } catch (error) {
      await store.close()
      throw error
    }
    return store
  }

  /** Opens a store as it is, migrating nothing: for the scripts that migrate it. */
  static async connect(options: SqliteStoreOptions): Promise<SqliteStore> {
    const temporary = options.path === ':memory:' ? join(tmpdir(), `framework-sqlite-${Bun.randomUUIDv7()}.db`) : null
    const path = temporary ?? options.path
    await mkdir(dirname(path), { recursive: true })
    const writer = SqliteStore.database(path)
    return new SqliteStore(writer, SqliteStore.database(path, true), temporary, options)
  }

  table<Row extends StoredRow>(name: string, options?: TableOptions<Row> & SqliteTableOptions<Row>): SqliteTable<Row> {
    return new SqliteTable<Row>(this.executor, name, options)
  }

  /** How the shared SQL code runs statements here: on the connection, in the transaction in progress. */
  private readonly executor: SqlExecutor = {
    all: async (sql, params) => this.connection.prepare(sql).all(...params as SQLQueryBindings[]) as Record<string, unknown>[],
    run: async (sql, params) => this.connection.prepare(sql).run(...params as SQLQueryBindings[]).changes,
    transaction: fn => this.transaction(fn),
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      return await this.scope.run(fn, undefined, {
        begin: () => { this.writer.run('BEGIN IMMEDIATE') },
        commit: () => { this.writer.run('COMMIT') },
        // An error SQLite rolled back on its own leaves nothing to roll back.
        rollback: () => { if (this.writer.inTransaction) this.writer.run('ROLLBACK') },
      })
    } catch (error) {
      throw isCollision(error) ? new ConcurrencyConflict() : error
    }
  }

  /** Its transactions run one at a time: a key is guarded by being in one. */
  guard(keys: string[]): Promise<void> {
    return this.scope.guard(keys)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  afterRollback(fn: () => void): void {
    this.scope.afterRollback(fn)
  }

  async close(): Promise<void> {
    await this.scope.drain()
    this.reader.close()
    this.writer.close()
    if (this.temporary) await Promise.all(['', '-wal', '-shm'].map(suffix => rm(`${this.temporary}${suffix}`, { force: true })))
  }

  /**
   * The connection as a `bun:sqlite` database. Each statement picks its connection as
   * it runs: the writing one inside a transaction, the reading one outside, where a
   * write is refused (and could not run anyway: that one is read only).
   */
  private routedConnection(): Database {
    const pick = (sql: string): Database => {
      if (this.scope.inTransaction) return this.writer
      if (WRITE.test(sql)) throw new Error('A write runs inside `store.transaction`')
      return this.reader
    }
    const statement = (sql: string): Statement => new Proxy({} as Statement, {
      get: (_, prop) => {
        const compiled = pick(sql).query(sql)
        const value = Reflect.get(compiled, prop, compiled) as unknown
        return typeof value === 'function' ? value.bind(compiled) : value
      },
    })
    return new Proxy(this.writer, {
      get: (writer, prop) => {
        switch (prop) {
          case 'prepare':
          case 'query': return statement
          case 'run':
          case 'exec': return (sql: string, ...params: never[]) => pick(sql).run(sql, ...params)
          case 'transaction': return () => { throw new Error('Transactions run with `store.transaction`') }
          default: {
            const value = Reflect.get(writer, prop, writer) as unknown
            return typeof value === 'function' ? value.bind(writer) : value
          }
        }
      },
    })
  }

  private static database(path: string, readonly = false): Database {
    const db = new Database(path, readonly ? { readonly: true } : { create: true, readwrite: true })
    if (!readonly) {
      // WAL lets readers go on while a write is in progress, and NORMAL sync is safe
      // with WAL: together they make writes much faster.
      db.run('PRAGMA journal_mode = WAL')
      db.run('PRAGMA synchronous = NORMAL')
      db.run('PRAGMA foreign_keys = ON')
    }
    db.run('PRAGMA busy_timeout = 5000')
    return db
  }
}
