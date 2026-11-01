import { findCurrentActor, TooManyRequests, type Clock } from '../core'
import { traceSpan } from '../core/internal'
import type { RateLimitStore, RateLimitTake } from '../port-rate-limit'
import { clientIp } from './client-ip'
import type { HttpRateLimit } from './http-rate-limit'
import type { HttpRoute } from './http-route'

/**
 * A route that takes from each of its limits before it runs, for whoever calls it:
 * `TooManyRequests` past one, and the closest one in its answer's headers otherwise.
 */
export function rateLimited(route: HttpRoute, limits: HttpRateLimit[], store: RateLimitStore, clock: Clock): HttpRoute {
  if (limits.length === 0) return route
  return async request => {
    let closest: RateLimitTake | null = null
    // Its own first: one refused there counts against none of those above it.
    for (const limit of limits.toReversed()) {
      const who = whoIs(limit, request)
      if (who === null) continue
      const take = await traceSpan(
        { kind: 'rate-limit', name: limit.name, attributes: { limit: limit.limit, windowMs: limit.windowMs, by: who.slice(0, who.indexOf(':')) } },
        async () => {
          const take = await store.take(`http:${limit.name}:${who}`, limit, clock.now())
          if (!take.allowed) throw new TooManyRequests(limit.name, take.retryAfterMs)
          return take
        },
        take => ({ remaining: take.remaining }),
      )
      if (!closest || take.remaining < closest.remaining) closest = take
    }
    const response = await route(request)
    if (!closest) return response
    // A Response.redirect's headers cannot change: a copy's can.
    const told = new Response(response.body, response)
    told.headers.set('ratelimit-limit', String(closest.limit))
    told.headers.set('ratelimit-remaining', String(closest.remaining))
    return told
  }
}

/** The key of a request's count under a limit: whose it is, or `null` for none. */
function whoIs({ by = 'actor' }: HttpRateLimit, request: Parameters<HttpRoute>[0]): string | null {
  if (typeof by === 'function') {
    const key = by(request)
    return key === null ? null : `key:${key}`
  }
  const actor = by === 'actor' ? findCurrentActor() : null
  return actor ? `actor:${actor.userId}` : `ip:${clientIp(request) ?? 'unknown'}`
}

/**
 * The limits of a route under some options (a router's or a group's) and its own:
 * both, the outer ones first and each name once, or only its own when it leaves out
 * those above (`false`).
 */
export function addLimits(outer: HttpRateLimit | HttpRateLimit[] | false | undefined, own: HttpRateLimit | HttpRateLimit[] | false | undefined): HttpRateLimit[] | false {
  if (own === false) return false
  const all = [...listOf(outer), ...listOf(own)]
  return all.filter((limit, i) => all.findIndex(other => other.name === limit.name) === i)
}

function listOf(limits: HttpRateLimit | HttpRateLimit[] | false | undefined): HttpRateLimit[] {
  return !limits ? [] : Array.isArray(limits) ? limits : [limits]
}
