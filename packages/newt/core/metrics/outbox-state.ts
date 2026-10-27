/** How full one queue is now, as a broker would say it, and whether any worker serves it. */
export type QueueState = {
  queue: string
  /** Jobs to run for the first time. */
  ready: number
  /** Jobs that failed, waiting to run again. */
  retrying: number
  /** Jobs a worker took and has not closed: a broker's unacked. */
  running: number
  dead: number
  /** When the oldest job due became due: null when none waits. */
  oldestDueAt: string | null
  /** When a worker last said it serves it: null for one none ever did. */
  lastSeenAt: string | null
  /** No worker serves it: its jobs wait and nobody runs them. */
  orphan: boolean
}

/** Every context's queues, as they are at a moment. */
export type OutboxState = { at: string, contexts: { context: string, queues: QueueState[] }[] }

/** A job out of attempts, without its event's payload: which queue, which event, why it died. */
export type DeadJob = {
  id: string
  queue: string
  /** The event's name: `card.created`. */
  event: string
  attempts: number
  lastError: string | null
  createdAt: string
  /** When it died: its last change. */
  diedAt: string
}

/** A page of dead jobs, oldest first. */
export type DeadJobs = { jobs: DeadJob[], hasMore: boolean }
