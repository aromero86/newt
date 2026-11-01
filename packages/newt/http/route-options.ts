import type { Cors } from './cors'
import type { ErrorHandler } from './error-handler'
import type { HttpRateLimit } from './http-rate-limit'
import type { Idempotency } from './idempotency'

/**
 * A route's options; a group's and a router's are the same, and a route's own come
 * first, but its rate limits, which add up to those above it.
 */
export type RouteOptions = {
  /** Reachable without signing in. Every other route needs a session. */
  public?: boolean
  /** Callable from pages of other origins: see `Cors`. */
  cors?: Cors
  /** What its errors become, a missing session's too: `toErrorResponse` unless told. */
  onError?: ErrorHandler
  /** For a POST: one sent again with the same `Idempotency-Key` gets the first answer. See `Idempotency`. */
  idempotency?: Idempotency
  /** How often each caller may call it: see `HttpRateLimit`. They add up to those above it; `false` leaves them out. */
  rateLimit?: HttpRateLimit | HttpRateLimit[] | false
  /** How long its request's body may be, in bytes: a 413 past it. A megabyte unless told. */
  maxBodyBytes?: number
  /**
   * A route that writes (POST, PUT, PATCH, DELETE) refuses what pages of other origins
   * send it, but those its `cors` names: a 403 (`cross_origin_refused`). `true` takes
   * them, for a form another site posts back on purpose (a payment's, a sign-in's).
   */
  crossOrigin?: boolean
}
