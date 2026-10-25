export type TableRepositoryOptions = {
  /**
   * Deleting an entity stamps its row's `deletedAt` instead of removing it, and
   * finding leaves those rows out: they keep their history and whatever points at them.
   */
  softDelete?: boolean
}
