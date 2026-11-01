import { join } from 'node:path'
import { PostgresStore } from 'newt-kit/adapter-postgres'
import { SqliteStore } from 'newt-kit/adapter-sqlite'

/** A store cooper runs on: SQLite, or Postgres. */
export type CooperStore = SqliteStore | PostgresStore

/** Whether a context's database is a Postgres server, by its address. */
const isPostgres = (database: string) => /^postgres(ql)?:\/\//.test(database)

/**
 * A context's store, by where its database is (`COOPER_<CONTEXT>_DATABASE`): a
 * `postgres://` address is Postgres, with the context's `migrations/postgres`; anything
 * else is a SQLite file (or `:memory:`), with its `migrations/sqlite`. Brought up to
 * date as it opens. MySQL would be one more line: `MySqlStore`, and its own folder.
 */
export function openStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.open({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.open({ path: database, migrations: join(migrations, 'sqlite') })
}

/** The same store as it is, migrating nothing: for the script that migrates it. */
export function connectStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.connect({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.connect({ path: database, migrations: join(migrations, 'sqlite') })
}
