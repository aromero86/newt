import {
  CamelCasePlugin,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { SQLQueryBindings } from 'bun:sqlite'
import type { SqlStore } from '../sql'
import { SqliteStore } from '../adapter-sqlite'

const NO_TRANSACTIONS = 'Transactions run with `store.transaction`, never Kysely\'s own: its queries join the one in progress'

type Execute = (query: CompiledQuery) => Promise<QueryResult<unknown>>

/**
 * Kysely on a store, for the queries a table cannot say: SQLite, Postgres or MySQL,
 * the same queries for any of them. Its statements run on the store's connections,
 * so inside `store.transaction` (a save, its hooks) they read and write in it.
 * Outside one, SQLite refuses a write, while Postgres and MySQL run it at once, on
 * its own: write only inside one. On Postgres and MySQL a write's result reports no
 * rows (`numUpdatedRows` is `0n`, no `insertId`). Field names are the rows'
 * (`productId`), turned into the columns' (`product_id`) on their way.
 *
 * ```ts
 * class AppBase extends Base<SqliteStore> {
 *   readonly db = kyselyFor<AppDatabase>(this.store)
 * }
 * ```
 *
 * Kysely's own transactions are refused: they would not be the store's.
 */
export function kyselyFor<Database>(store: SqliteStore | SqlStore): Kysely<Database> {
  return new Kysely<Database>({ dialect: dialectFor(store), plugins: [new CamelCasePlugin()] })
}

function dialectFor(store: SqliteStore | SqlStore): Dialect {
  if (store instanceof SqliteStore) {
    return {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new StoreDriver(async query => {
        // The connection's cached statement for its SQL, run whole (`all`, `run`): never left halfway.
        const statement = store.connection.query(query.sql)
        const params = query.parameters as SQLQueryBindings[]
        if (statement.columnNames.length > 0) return { rows: statement.all(...params) }
        const { changes, lastInsertRowid } = statement.run(...params)
        return { rows: [], numAffectedRows: BigInt(changes), insertId: BigInt(lastInsertRowid) }
      }),
      createIntrospector: db => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    }
  }
  const driver = () => new StoreDriver(async query => ({ rows: await store.query(query.sql, [...query.parameters]) }))
  return store.database === 'postgres'
    ? { createAdapter: () => new PostgresAdapter(), createDriver: driver, createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler() }
    : { createAdapter: () => new MysqlAdapter(), createDriver: driver, createIntrospector: db => new MysqlIntrospector(db), createQueryCompiler: () => new MysqlQueryCompiler() }
}

/** Kysely's driver on a store: one connection that is the store's, and no transactions of its own. */
class StoreDriver implements Driver {

  private readonly connection: DatabaseConnection

  constructor(execute: Execute) {
    this.connection = {
      executeQuery: async <Row>(query: CompiledQuery) => await execute(query) as QueryResult<Row>,
      streamQuery: async function* <Row>(query: CompiledQuery): AsyncIterableIterator<QueryResult<Row>> {
        yield await execute(query) as QueryResult<Row>
      },
    }
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection
  }

  async beginTransaction(): Promise<void> {
    throw new Error(NO_TRANSACTIONS)
  }

  async commitTransaction(): Promise<void> {
    throw new Error(NO_TRANSACTIONS)
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error(NO_TRANSACTIONS)
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}
