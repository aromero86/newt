// newt/adapter-sql: what every SQL store shares, for an adapter to build on: a table that
// translates criteria into SQL in the adapter's dialect, run by the adapter's executor.
// The SQL stores on Bun.SQL (Postgres, MySQL) add theirs when they come.

export type { SqlDialect } from './sql-dialect'
export type { SqlExecutor } from './sql-executor'
export { SqlTable } from './sql-table'
export type { SqlTableOptions } from './sql-table-options'
export { splitStatements } from './split-statements'
