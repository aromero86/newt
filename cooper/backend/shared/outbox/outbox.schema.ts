/**
 * A job that ran out of attempts, as whoever looks after a context's jobs sees it: the
 * reaction it was (`queue`), to which event, how many times it ran and why it failed
 * the last time. Its event's payload stays out: it may say more than the staff need.
 */
export type DeadJobDTO = {
  id: string
  queue: string
  /** The event's name: `card.assigned`. */
  event: string
  attempts: number
  lastError: string | null
  createdAt: string
  /** When it died. */
  updatedAt: string
}
