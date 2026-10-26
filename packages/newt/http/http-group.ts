import type { BunRequest } from 'bun'
import type { HttpRoute } from './http-route'
import type { HttpRouter } from './http-router'
import type { Middleware } from './middleware'
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
    this.router.get(`${this.prefix}${path}`, this.around(route), { ...this.options, ...options })
  }

  post<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.post(`${this.prefix}${path}`, this.around(route), { ...this.options, ...options })
  }

  put<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.put(`${this.prefix}${path}`, this.around(route), { ...this.options, ...options })
  }

  patch<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.patch(`${this.prefix}${path}`, this.around(route), { ...this.options, ...options })
  }

  delete<Path extends string>(path: Path, route: HttpRoute<`${Prefix}${Path}`>, options?: RouteOptions): void {
    this.router.delete(`${this.prefix}${path}`, this.around(route), { ...this.options, ...options })
  }

  private around<Path extends string>(route: HttpRoute<`${Prefix}${Path}`>): HttpRoute<`${Prefix}${Path}`> {
    return request => this.middleware(request as unknown as BunRequest<Prefix>, async () => route(request))
  }
}
