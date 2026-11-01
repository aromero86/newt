import type { BunRequest } from 'bun'
import type { HttpRoute } from './http-route'
import type { HttpRouter } from './http-router'
import type { Middleware } from './middleware'
import { addLimits } from './rate-limited'
import type { RouteOptions } from './route-options'

/**
 * Routes under one prefix that share a middleware (`HttpRouter.group`): a route's
 * params are the prefix's and its own (`/workspaces/:workspaceId` + `/brands/:id`).
 * The group's options are each route's, unless it says otherwise.
 */
export class HttpGroup<Prefix extends string> {

  constructor(
    private readonly router: HttpRouter,
    private readonly prefix: Prefix,
    private readonly middleware: Middleware<Prefix>,
    private readonly options: RouteOptions = {},
  ) {}

  get<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.get(`${this.prefix}${path}`, this.around(route), this.with(options))
  }

  post<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.post(`${this.prefix}${path}`, this.around(route), this.with(options))
  }

  put<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.put(`${this.prefix}${path}`, this.around(route), this.with(options))
  }

  patch<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.patch(`${this.prefix}${path}`, this.around(route), this.with(options))
  }

  delete<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.delete(`${this.prefix}${path}`, this.around(route), this.with(options))
  }

  /** The group's options under a route's own: its rate limits added to the group's. */
  private with(options: RouteOptions = {}): RouteOptions {
    return { ...this.options, ...options, rateLimit: addLimits(this.options.rateLimit, options.rateLimit) }
  }

  private around<Path extends string>(route: HttpRoute<`${Prefix}${Path}`>): HttpRoute<`${Prefix}${Path}`> {
    return request => this.middleware(request as unknown as BunRequest<Prefix>, async () => route(request))
  }
}
