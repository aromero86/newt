import type { Cors } from './cors'

/** A route's options; a group's and a router's are the same, and a route's own come first. */
export type RouteOptions = {
  /** Reachable without signing in. Every other route needs a session. */
  public?: boolean
  /** Callable from pages of other origins: see `Cors`. */
  cors?: Cors
}
