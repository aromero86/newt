// newt/store: the port a store implements (its tables, its transactions, its outbox
// and its migrations) and the repositories built on it. Each store is an adapter of
// its own (newt/adapter-sqlite, newt/adapter-files…).

// The port
export type { Store } from './store'
export type { Table } from './table'
export type { TableOptions } from './table-options'
export type { FieldType } from './field-type'
export type { FindOptions } from './find-options'
export type { NewRow } from './new-row'
export type { StoredRow } from './stored-row'
export type { Migrations } from './migrations'
export { migrationName } from './migration-name'
export { TransactionScope } from './transaction-scope'

// Repositories
export { Repository } from './repository'
export type { RepositoryBase } from './repository-base'
export type { SaveHooks } from './save-hooks'
export { TableRepository } from './table-repository'
export type { TableRepositoryOptions } from './table-repository-options'
