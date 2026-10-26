import type { Job } from './job'
import type { JobClosing } from './job-closing'
import type { JobQueueRegistration } from './job-queue-registration'

/**
 * Where a store keeps its jobs: the outbox, in the same storage as its data, so a job
 * is written in the transaction of the change that publishes it. Each adapter has
 * its own; the worker (`JobQueue`) only knows this.
 */
export interface Outbox {
  /** Writes jobs in the transaction in progress; in one of their own outside any. */
  add(jobs: Job[]): Promise<void>
  /**
   * Claims up to `limit` jobs of these queues, at once, so no other worker claims the
   * same ones: pending and due, or running with their lease run out. Each claim counts
   * one more attempt, and is locked by `worker`: a name no claim used before (the
   * worker's, and which of its claims), since it fences the claim with `attempts`.
   */
  claim(queues: string[], limit: number, worker: string, leaseUntil: string): Promise<Job[]>
  /** Moves the lease of a claim on, if it is still the claim it was. */
  renew(claimed: Job, leaseUntil: string): Promise<void>
  /** Ends a claim, if it is still the claim it was. */
  close(claimed: Job, closing: JobClosing): Promise<void>
  /**
   * Puts a dead job back to wait, as new: no attempts, due now. For whoever fixed
   * what killed it. Whether it was dead and is now waiting: a job in any other state,
   * or none with that id, is left as it is.
   */
  retry(id: string): Promise<boolean>
  /** Registers the queues a worker runs, as they are now, and says they are alive. */
  seen(queues: JobQueueRegistration[]): Promise<void>
  /** Forgets the jobs done before `before`: they are only history. */
  purge(before: string): Promise<void>
  /** Every job it keeps, oldest first: for whoever looks after them (an admin page, a test). */
  list(): Promise<Job[]>
  /**
   * How many jobs of each queue are still to run (pending or running), for the
   * queues that have any: what the worker looks at every minute, so it reads no job
   * done nor any payload.
   */
  waiting(): Promise<{ queue: string, jobs: number }[]>
  /** Every queue a worker registered, and when one last said it was alive. */
  queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]>
}
