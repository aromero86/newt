import type { RouteOptions } from './route-options'

/** Where its routes go, and the options every route of it has unless it says otherwise. */
export type HttpRouterOptions = RouteOptions & {
  /** Where every route goes: `/api` unless told otherwise. */
  prefix?: string
}
