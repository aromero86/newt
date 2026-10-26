/** A queue a worker runs: one handler subscribed in `handler` mode. */
export type JobQueueRegistration = {
  name: string
  /** The events it handles. */
  event: string
  attempts: number
}
