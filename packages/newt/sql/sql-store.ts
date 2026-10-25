import { SQL, type ReservedSQL } from 'bun'
import { join } from 'node:path'
import { ConcurrencyConflict } from '../core'
import { TransactionScope, type Migrations, type Store, type StoredRow, type TableOptions } from '../port-store'
import type { SqlExecutor } from './sql-executor'
import { SqlMigrationRunner } from './sql-migration-runner'
import { SqlOutbox } from './sql-outbox'
import type { SqlServerDialect } from './sql-server-dialect'
import type { SqlStoreOptions } from './sql-store-options'
import { SqlTable } from './sql-table'
import type { SqlTableOptions } from './sql-table-options'

type Rows = Record<string, unknown>[]
type State = { connection?: ReservedSQL }

/**
 * A store on a database server (Postgres, MySQL), through `Bun.SQL`: a pool of
 * connections, and transactions that run side by side. Each transaction reserves a
 * connection until it ends; reads outside one take any from the pool, and see only
 * what is committed.
 *
 * Side by side, what keeps a rule over several rows true is its `guard`: the keys a
 * transaction guards are locks in the database (advisory locks), so two transactions
 * guarding the same key take turns, and the rest never wait for each other. A
 * transaction the database gives up (a deadlock, a serialization failure) is a
 * `ConcurrencyConflict`, which a use case runs again (unless `retryOnConflict: false`).
 */
export class SqlStore implements Store {

  readonly outbox: SqlOutbox
  readonly migrations: Migrations

  private readonly scope: TransactionScope<State>

  protected constructor(
    private readonly sql: SQL,
    private readonly dialect: SqlServerDialect,
    private readonly options: SqlStoreOptions,
  ) {
    this.scope = new TransactionScope<State>(options.waitTimeoutMs, false)
    const inTransaction = <T>(fn: (run: (sql: string, params?: unknown[]) => Promise<Rows>) => Promise<T>) => this.transaction(() => fn((text, params) => this.query(text, params)))
    this.outbox = new SqlOutbox(dialect, inTransaction, (text, params) => this.query(text, params))
    const own = new SqlMigrationRunner(dialect, inTransaction, options.migrations)
    const framework = new SqlMigrationRunner(dialect, inTransaction, join(import.meta.dir, 'migrations', dialect.name), 'framework_migrations')
    this.migrations = {
      up: async () => {
        const applied = await own.up()
        await framework.up()
        return applied
      },
      down: () => own.down(),
      status: () => own.status(),
    }
  }

  protected static pool(options: SqlStoreOptions): SQL {
    return new SQL({ url: options.url, max: options.connections ?? 10 })
  }

  /** Which database it is on: `postgres`, `mysql`. */
  get database(): SqlServerDialect['name'] {
    return this.dialect.name
  }

  table<Row extends StoredRow>(name: string, options?: TableOptions<Row> & SqlTableOptions<Row>): SqlTable<Row> {
    return new SqlTable<Row>(this.executor, this.dialect, name, options)
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const state: State = {}
    try {
      return await this.scope.run(fn, state, {
        begin: async () => {
          state.connection = await this.sql.reserve()
          await state.connection.unsafe(this.dialect.begin)
        },
        commit: async () => { await state.connection!.unsafe('COMMIT') },
        rollback: async () => { await state.connection?.unsafe('ROLLBACK') },
        end: async () => {
          if (!state.connection) return
          try {
            await this.dialect.release(state.connection)
          } finally {
            state.connection.release()
          }
        },
      })
    } catch (error) {
      throw this.dialect.isCollision(error) || this.dialect.isConflict(error) ? new ConcurrencyConflict() : error
    }
  }

  async guard(keys: string[]): Promise<void> {
    const connection = this.scope.state?.connection
    if (!connection) throw new Error('A guard is taken inside a transaction')
    await this.dialect.lock(connection, [...new Set(keys)].sort(), this.options.waitTimeoutMs ?? 30_000)
  }

  afterCommit(fn: () => void): void {
    this.scope.afterCommit(fn)
  }

  async close(): Promise<void> {
    await this.scope.drain()
    await this.sql.close()
  }

  /** Runs a statement in the transaction in progress, or on any connection of the pool. */
  async query(text: string, params: unknown[] = []): Promise<Rows> {
    return [...await this.client().unsafe(text, params)] as Rows
  }

  private client(): SQL | ReservedSQL {
    return this.scope.state?.connection ?? this.sql
  }

  private readonly executor: SqlExecutor = {
    all: (text, params) => this.query(text, params),
    run: async (text, params) => this.dialect.changed(await this.client().unsafe(text, params)),
    transaction: async fn => {
      const connection = this.scope.state?.connection
      if (!connection || !this.dialect.failedStatementAborts) return this.transaction(fn)
      const savepoint = `write_${++this.savepoints}`
      await connection.unsafe(`SAVEPOINT ${savepoint}`)
      try {
        const result = await fn()
        await connection.unsafe(`RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (error) {
        await connection.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        throw error
      }
    },
  }

  private savepoints = 0
}
