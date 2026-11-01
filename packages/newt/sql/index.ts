// newt-kit/sql: what every SQL store shares, for an adapter to build on: a table that
// translates criteria into SQL in the adapter's dialect, run by the adapter's executor;
// and, for a database server on Bun.SQL (Postgres, MySQL), the whole store, given its
// dialect.

// Any SQL store
export type { SqlDialect } from './sql-dialect'
export type { SqlExecutor } from './sql-executor'
export { SqlTable } from './sql-table'
export type { SqlTableOptions } from './sql-table-options'
export { splitStatements } from './split-statements'

// A store on a database server
export { SqlStore } from './sql-store'
export type { SqlStoreOptions } from './sql-store-options'
export type { SqlServerDialect } from './sql-server-dialect'
export { SqlOutbox } from './sql-outbox'
export { SqlMigrationRunner } from './sql-migration-runner'
export { errorCode } from './error-code'
