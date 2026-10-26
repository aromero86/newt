// newt/port-store: the port a store implements: its tables, its transactions, its
// outbox and its migrations. Each store is an adapter of its own (newt/adapter-sqlite,
// newt/adapter-files…); newt/port-store/contract checks one keeps every promise.

export type { Store } from './store'
export type { Table } from './table'
export type { TableOptions } from './table-options'
export type { FieldType } from './field-type'
export type { FindOptions } from './find-options'
export type { NewRow } from './new-row'
export type { StoredRow } from './stored-row'
export type { Migrations } from './migrations'
export { migrationName } from './migration-name'
export { migrationChecksum } from './migration-checksum'
export { TransactionScope } from './transaction-scope'
export { noteRead } from './note-read'
