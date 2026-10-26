import { SQL, type ReservedSQL } from 'bun'
import { AsyncLocalStorage } from 'node:async_hooks'
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
/** A transaction's connection, and the turn its statements take on it, one at a time. */
type State = { connection?: ReservedSQL, turn: Promise<void> }

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
 *
 * The statements of one transaction take turns on its connection, so writes side by
 * side in it (a `Promise.all`) behave as in any store: a write and its savepoint run
 * whole before the next statement.
 */
export class SqlStore implements Store {

  readonly outbox: SqlOutbox
  readonly migrations: Migrations

  private readonly scope: TransactionScope<State>
  /** The transaction whose turn this code holds: what it runs goes straight to the connection. */
  private readonly holding = new AsyncLocalStorage<State>()

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
    const state: State = { turn: Promise.resolve() }
    try {
      return await this.scope.run(fn, state, {
        begin: async () => {
          state.connection = await this.sql.reserve()
          for (const statement of this.dialect.begin) await state.connection.unsafe(statement)
        },
        commit: () => this.inTurn(state, async connection => {
          // Postgres answers COMMIT with ROLLBACK when a statement failed in the transaction and spoiled it.
          const result = await connection.unsafe('COMMIT') as { command?: string }
          if (result.command === 'ROLLBACK') throw new Error('The transaction was rolled back, not committed: a statement in it failed, which spoils a Postgres transaction')
        }),
        rollback: async () => {
          if (state.connection) await this.inTurn(state, connection => connection.unsafe('ROLLBACK'))
        },
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
    this.scope.assertNotEnded()
    const state = this.scope.state
    if (!state) throw new Error('A guard is taken inside a transaction')
    await this.onConnection(state, connection => this.dialect.lock(connection, [...new Set(keys)].sort(), this.options.waitTimeoutMs ?? 30_000))
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
    return [...await this.statement(text, params) as Rows]
  }

  /** A statement in the transaction in progress, in its turn; outside one, on any connection of the pool. */
  private statement(text: string, params: unknown[]): Promise<unknown> {
    this.scope.assertNotEnded()
    const state = this.scope.state
    return state ? this.onConnection(state, connection => connection.unsafe(text, params)) : this.sql.unsafe(text, params)
  }

  /** Runs `fn` on the transaction's connection in its turn, unless the transaction ended while it waited. */
  private onConnection<T>(state: State, fn: (connection: ReservedSQL) => Promise<T>): Promise<T> {
    return this.inTurn(state, connection => {
      this.scope.assertNotEnded()
      return fn(connection)
    })
  }

  /** Runs `fn` on the transaction's connection once the statements before it ended, holding the next ones until it does. */
  private async inTurn<T>(state: State, fn: (connection: ReservedSQL) => Promise<T>): Promise<T> {
    if (this.holding.getStore() === state) return fn(state.connection!)
    const before = state.turn
    let done!: () => void
    state.turn = new Promise(resolve => { done = resolve })
    try {
      await before
      return await this.holding.run(state, () => fn(state.connection!))
    } finally {
      done()
    }
  }

  private readonly executor: SqlExecutor = {
    all: (text, params) => this.query(text, params),
    run: async (text, params) => this.dialect.changed(await this.statement(text, params)),
    transaction: async fn => {
      this.scope.assertNotEnded()
      const state = this.scope.state
      if (!state) return this.transaction(fn)
      if (!this.dialect.failedStatementAborts) return fn()
      // The savepoint, the write and its release run in one turn: another statement never comes in between.
      return this.onConnection(state, async connection => {
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
      })
    },
  }

  private savepoints = 0
}
