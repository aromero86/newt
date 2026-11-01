/** What a take answered: whether it was let through, what is left, and how long to wait if not. */
export type RateLimitTake = {
  allowed: boolean
  /** The rule's limit. */
  limit: number
  /** How many more takes the key has now: 0 when it was refused. */
  remaining: number
  /** How long until a take would be let through: 0 when this one was. */
  retryAfterMs: number
}
