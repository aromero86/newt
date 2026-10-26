export type JobQueueOptions = {
  /** How many jobs a worker runs side by side. */
  concurrency: number
  /** How often it looks for jobs when nothing woke it: after a commit, it looks at once. */
  pollMs: number
  /** How long a claimed job is the worker's; it renews the lease every third of it while it runs. */
  leaseMs: number
  /** The wait before the first retry, doubled on each one after, up to `maxBackoffMs`. */
  backoffMs: number
  maxBackoffMs: number
  /** How long a job done is kept before it is purged. */
  keepDoneMs: number
  /**
   * How often a worker says its queues are alive, and looks for jobs waiting in a
   * queue no worker serves: one unseen for five times this is served by nobody.
   */
  seenEveryMs: number
}
