export type UseCaseOptions = {
  /**
   * Runs it again, from the start, when what it saves was saved by someone else since
   * it read it (`ConcurrencyConflict`), up to `RETRIES` times: by default, since a use
   * case reads, decides and saves, and what cannot be undone leaves from a worker.
   * `false` for one that does something before saving that must not happen twice
   * (a call to another context that already saved), with the reason beside it.
   */
  retryOnConflict?: boolean
  /**
   * The other modules this use case may write to although it is not a worker's: an
   * exception to the rule, written where it is seen, with its reason beside it.
   */
  writesTo?: string[]
}
