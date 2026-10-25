import { SqlTable, type SqlExecutor } from '../adapter-sql'
import type { StoredRow, TableOptions } from '../store'
import { sqliteDialect } from './sqlite-dialect'
import type { SqliteTableOptions } from './sqlite-table-options'

/**
 * A table of a SQLite store: the shared SQL table, in SQLite's dialect. Its booleans
 * are 0 and 1 and its JSON is text: `types` says which fields those are.
 */
export class SqliteTable<Row extends StoredRow> extends SqlTable<Row> {
  constructor(executor: SqlExecutor, name: string, options?: TableOptions<Row> & SqliteTableOptions<Row>) {
    super(executor, sqliteDialect, name, options)
  }
}
