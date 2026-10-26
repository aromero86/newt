import type { Cors } from './cors'
import type { ErrorHandler } from './error-handler'
import type { Idempotency } from './idempotency'

/** A route's options; a group's and a router's are the same, and a route's own come first. */
export type RouteOptions = {
  /** Reachable without signing in. Every other route needs a session. */
  public?: boolean
  /** Callable from pages of other origins: see `Cors`. */
  cors?: Cors
  /** What its errors become, a missing session's too: `toErrorResponse` unless told. */
  onError?: ErrorHandler
  /** For a POST: one sent again with the same `Idempotency-Key` gets the first answer. See `Idempotency`. */
  idempotency?: Idempotency
}
