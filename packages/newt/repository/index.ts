// newt-kit/repository: the only place a module reads and writes its entities, on any store:
// `TableRepository` when they are the rows of one table, `Repository` for anything else.

export { Repository } from './repository'
export type { RepositoryBase } from './repository-base'
export type { SaveHooks } from './save-hooks'
export { TableRepository } from './table-repository'
export type { RepositoryScope, TableRepositoryOptions } from './table-repository-options'
