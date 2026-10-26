import type { StoredRow } from '../port-store'

/**
 * What a repository's rows belong to (a workspace, a tenant): `field` says which, and
 * `current` gives the one of the work in progress, usually a scope's
 * (`workspace.current()`).
 */
export type RepositoryScope<Row extends StoredRow = StoredRow> = { field: Extract<keyof Row, string>, current: () => string }

export type TableRepositoryOptions<Row extends StoredRow = StoredRow> = {
  /**
   * Deleting an entity stamps its row's `deletedAt` instead of removing it, and
   * finding leaves those rows out: they keep their history and whatever points at them.
   */
  softDelete?: boolean
  /**
   * What its rows belong to, said by every repository: a scope, or `'none'`.
   *
   * With a scope, finding, counting and paging see only the current one's rows, and
   * saving refuses an entity of another, or one stored in another: none of those can
   * forget it (what a subclass does on its own through `this.table` adds it itself).
   * Outside a scope `current` throws, so a worker enters the scope before using the
   * repository.
   *
   * `'none'` says, where it is read, that its rows belong to no tenant (people, a
   * product's clients) or are reached across tenants on purpose. It is required, so a
   * scope is never dropped by leaving it out: dropping it is writing `'none'`.
   */
  scope: RepositoryScope<Row> | 'none'
}
