import { SqlStore, type SqlStoreOptions } from '../sql'
import { mysqlDialect } from './mysql-dialect'

/**
 * The MySQL store, on `Bun.SQL`. Its migrations are MySQL SQL; MySQL commits a
 * change of structure at once, with what came before it, so a batch that fails after
 * one keeps that (a batch of data alone is all or none), as in any transaction. An
 * entity table has `id VARCHAR(36) PRIMARY KEY` and `version INTEGER NOT NULL`; text
 * columns are best `utf8mb4_0900_bin`, and a json field's column is `JSON`; a unique
 * value among the rows not deleted is a functional unique index on
 * `(IF(deleted_at IS NULL, col, NULL))`.
 */
export class MySqlStore extends SqlStore {

  /** Opens a store and brings it up to date: its own migrations, then the framework's (its outbox). */
  static async open(options: SqlStoreOptions): Promise<MySqlStore> {
    const store = await MySqlStore.connect(options)
    try {
      await store.migrations.up()
    } catch (error) {
      await store.close()
      throw error
    }
    return store
  }

  /** Opens a store as it is, migrating nothing: for the scripts that migrate it. */
  static async connect(options: SqlStoreOptions): Promise<MySqlStore> {
    return new MySqlStore(SqlStore.pool(options), mysqlDialect, options)
  }
}
