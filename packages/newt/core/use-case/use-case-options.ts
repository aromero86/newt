export type UseCaseOptions = {
  /**
   * Runs it again, from the start, when what it saves was saved by someone else since
   * it read it (`ConcurrencyConflict`), up to `RETRIES` times. Only for use cases that
   * may run twice: they read, decide and save, and do nothing else before saving.
   */
  retryOnConflict?: boolean
  /**
   * The other modules this use case may write to although it is not a worker's: an
   * exception to the rule, written where it is seen, with its reason beside it.
   */
  writesTo?: string[]
}
