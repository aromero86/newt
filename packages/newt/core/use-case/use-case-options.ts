export type UseCaseOptions = {
  /**
   * Runs it again, from the start, when what it saves was saved by someone else since
   * it read it (`ConcurrencyConflict`), up to `RETRIES` times: by default, since a use
   * case reads, decides and saves, and what cannot be undone leaves from a worker.
   * Only the first use case of a chain runs again, with all it calls: one called by
   * another lets the conflict through to it.
   * `false` for one that does something before saving that must not happen twice
   * (a call to another context that already saved), with the reason beside it: then
   * no use case of the chain runs again, not even the ones that called it.
   */
  retryOnConflict?: boolean
  /**
   * The other modules this use case, or any it calls, may write to although it is
   * not a worker's: an exception to the rule, written where it is seen, with its
   * reason beside it.
   */
  writesTo?: string[]
}
