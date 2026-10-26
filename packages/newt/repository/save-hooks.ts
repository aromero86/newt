/**
 * What a save runs besides writing its entities, in the same transaction. A save
 * with `after` names what it guards, so a rule over several rows is never left
 * unguarded by forgetting it: `guard: []` says, where it is read, that none is needed,
 * so the save reads no rows (the guard rule refuses one that does).
 */
export type SaveHooks = {
  /** Writes what must go first: the rows the entities replace. */
  before?: () => void | Promise<void>
} & (
  | { after?: undefined, guard?: string[] }
  | {
      /**
       * Runs once they are written: writes what follows from them, or checks a rule
       * over several rows (a stock never below zero), throwing to roll it all back.
       */
      after: () => void | Promise<void>
      /**
       * What that rule protects (`stock:<productId>`): no other save guarding one of
       * these runs in between, in any store. In SQLite saves already run one at a
       * time, so a missing key would fail only on a store that runs them side by side:
       * the guard rule refuses, on every store, a save that reads rows and guards nothing.
       */
      guard: string[]
    }
)
