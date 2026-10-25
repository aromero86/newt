/** What a save runs besides writing its entities, in the same transaction. */
export type SaveHooks = {
  /**
   * What the save's rule over several rows guards (`stock:<productId>`): no other save
   * guarding one of these runs in between, in any store. Name it whenever `after`
   * checks such a rule.
   */
  guard?: string[]
  /** Writes what must go first: the rows the entities replace. */
  before?: () => void | Promise<void>
  /**
   * Runs once they are written: writes what follows from them, or guards a rule over
   * several rows, throwing to roll all of it back.
   */
  after?: () => void | Promise<void>
}
