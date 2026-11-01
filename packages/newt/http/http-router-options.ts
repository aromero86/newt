import type { Clock } from '../core'
import type { RateLimitStore } from '../port-rate-limit'
import type { RouteOptions } from './route-options'

/** Where its routes go, and the options every route of it has unless it says otherwise. */
export type HttpRouterOptions = RouteOptions & {
  /**
   * Where every route goes: `/api` unless told otherwise. Anything else under it is a
   * 404. `''` mounts it at the root, beside the frontend (`/oauth/token`, `/mcp`,
   * `/.well-known/…`): it takes only its own paths then.
   */
  prefix?: string
  /**
   * Where its routes' rate limits count what each caller did: in its memory unless
   * told, enough for one instance; a `TableRateLimitStore` on the context's store, or
   * Redis's, when several instances share the work.
   */
  rateLimits?: RateLimitStore
  /** What tells the time to its rate limits: the context's, when its `Base` has one a test moves. The real time unless told. */
  clock?: Clock
}
