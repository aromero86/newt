import { SqlStore, type SqlStoreOptions } from '../adapter-sql'
import { postgresDialect } from './postgres-dialect'

/**
 * The Postgres store, on `Bun.SQL`. Its migrations are Postgres SQL, applied all or
 * none; an entity's table has `id TEXT PRIMARY KEY` and `version INTEGER NOT NULL`, a
 * boolean is `BOOLEAN` and JSON is `JSONB`.
 */
export class PostgresStore extends SqlStore {

  /** Opens a store and brings it up to date: its own migrations, then the framework's (its outbox). */
  static async open(options: SqlStoreOptions): Promise<PostgresStore> {
    const store = await PostgresStore.connect(options)
    try {
      await store.migrations.up()
    } catch (error) {
      await store.close()
      throw error
    }
    return store
  }

  /** Opens a store as it is, migrating nothing: for the scripts that migrate it. */
  static async connect(options: SqlStoreOptions): Promise<PostgresStore> {
    return new PostgresStore(SqlStore.pool(options), postgresDialect, options)
  }
}
