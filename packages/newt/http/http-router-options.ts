import type { RouteOptions } from './route-options'

/** Where its routes go, and the options every route of it has unless it says otherwise. */
export type HttpRouterOptions = RouteOptions & {
  /**
   * Where every route goes: `/api` unless told otherwise. Anything else under it is a
   * 404. `''` mounts it at the root, beside the frontend (`/oauth/token`, `/mcp`,
   * `/.well-known/…`): it takes only its own paths then.
   */
  prefix?: string
}
