import type { Job } from './job'
import type { JobClosing } from './job-closing'
import type { JobQuery } from './job-query'
import type { JobQueueRegistration } from './job-queue-registration'
import type { QueueDepth } from './queue-depth'

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
   * Due and run out are as of `now`, the worker's time: the real one if not given.
   */
  claim(queues: string[], limit: number, worker: string, leaseUntil: string, now?: string): Promise<Job[]>
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
  /**
   * The jobs it keeps, oldest first (by `createdAt`, then `id`), all of them or those
   * `query` says: for whoever looks after them (an admin page, a test).
   */
  list(query?: JobQuery): Promise<Job[]>
  /** One job, by its id; none if it is not kept. */
  get(id: string): Promise<Job | undefined>
  /**
   * How many jobs of each queue are still to run (pending or running), for the
   * queues that have any: what the worker looks at every minute, so it reads no job
   * done nor any payload.
   */
  waiting(): Promise<{ queue: string, jobs: number }[]>
  /**
   * How full each queue with any job not done is now: ready, retrying, running and
   * dead, and since when its oldest job due (as of `now`) waits. It reads no payload.
   */
  depth(now: string): Promise<QueueDepth[]>
  /** Every queue a worker registered, and when one last said it was alive. */
  queues(): Promise<(JobQueueRegistration & { lastSeenAt: string })[]>
}
