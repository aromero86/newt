/**
 * What a handler subscribed in `handler` mode does in reaction to an event: written
 * with the change that published it, in its transaction, so both are stored or
 * neither is. A worker claims it with a lease (`lockedBy` until `lockedUntil`); once
 * the lease runs out, its worker is taken for gone and another may claim it.
 * `attempts` counts claims and fences each one: a worker only closes the claim it made.
 */
export type Job = {
  id: string
  /** The handler's queue: its subscription's name. */
  queue: string
  /** The event, as JSON. */
  event: string
  status: 'pending' | 'running' | 'done' | 'dead'
  attempts: number
  runAfter: string
  lockedBy: string | null
  lockedUntil: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}
