import type { BunRequest } from 'bun'
import type { RateLimitRule } from '../port-rate-limit'

/**
 * How often each caller may call some routes: a router's, a group's or a route's
 * option. Unlike the others, they add up: a route counts against its router's limit,
 * its group's and its own, each a count of its own, and a route that says
 * `rateLimit: false` leaves out those above it. Routes whose limits share a `name`
 * share a count, so a router's limit is the whole context's, and a group's the group's.
 * A route's own is taken first: a request it refuses counts against none above it.
 *
 * Past one, it is a 429 (`too_many_requests`) with `Retry-After`; within them, the
 * answer says the closest one in `RateLimit-Limit` and `RateLimit-Remaining`.
 */
export type HttpRateLimit = RateLimitRule & {
  /** What it counts as, `api`, `cards.create`: limits of the same name share a count. */
  name: string
  /**
   * Who each count is: the signed-in actor, or the address it came from when no one
   * is (`actor`, unless told); always the address (`ip`); or a key of the route's own,
   * no limit when it gives `null`. The address is the socket's unless `serve` trusts
   * a proxy in front (`trustProxy`).
   */
  by?: 'actor' | 'ip' | ((request: BunRequest) => string | null)
}
