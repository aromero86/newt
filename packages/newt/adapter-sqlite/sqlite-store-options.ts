export type SqliteStoreOptions = {
  /**
   * A file path, or `:memory:` for one that lives only until it is closed (tests): a
   * temporary file, so it behaves exactly as one on a path does.
   */
  path: string
  /** The folder of the context's migrations; none for a store with no tables of its own. */
  migrations?: string
  /** How long a call waits for the store, behind the transactions before it, before it gives up: 30 s by default. */
  waitTimeoutMs?: number
}
