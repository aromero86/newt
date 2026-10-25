import type { StoredRow } from '../port-store'

export type TableRepositoryOptions<Row extends StoredRow = StoredRow> = {
  /**
   * Deleting an entity stamps its row's `deletedAt` instead of removing it, and
   * finding leaves those rows out: they keep their history and whatever points at them.
   */
  softDelete?: boolean
  /**
   * What its rows belong to (a workspace, a tenant): `field` says which, and `current`
   * gives the one of the work in progress, usually a scope's (`workspace.current()`).
   * Finding, counting and paging see only that one's rows, and saving refuses an
   * entity of another: none of those can forget it (what a subclass does on its own
   * through `this.table` adds it itself). Outside a scope `current` throws, so a
   * worker enters the scope before using the repository.
   */
  scope?: { field: Extract<keyof Row, string>, current: () => string }
}
