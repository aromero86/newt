import type { BunRequest } from 'bun'
import { runAsActor } from '../core'
import type { Authenticator } from './authenticator'
import { ApiRouteNotFound } from './errors/api-route-not-found'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { NotSignedIn } from './errors/not-signed-in'
import { handle } from './handle'
import { HttpGroup } from './http-group'
import type { HttpMethod } from './http-method'
import type { HttpRoute } from './http-route'
import type { RouteOptions } from './route-options'
import type { HttpRouterOptions } from './http-router-options'
import type { Middleware } from './middleware'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * A context's HTTP entry. Each module registers its own routes on it, and the server
 * takes the whole table (`serve`). Whatever a route throws becomes an error response.
 *
 * Every route needs a session unless it is registered as public. A signed-in
 * request runs as its actor, so every use case it calls knows who is doing it.
 */
export class HttpRouter {

  private readonly table = new Map<string, Map<HttpMethod, HttpRoute>>()
  private readonly prefix: string
  private authenticator: Authenticator | null = null

  constructor(options: HttpRouterOptions = {}) {
    this.prefix = options.prefix ?? '/api'
  }

  /** Tells who sends each request: set by the module that knows the sessions. */
  authenticateWith(authenticator: Authenticator): void {
    this.authenticator = authenticator
  }

  get<Path extends string>(path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    this.add('GET', path, route, options)
  }

  post<Path extends string>(path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    this.add('POST', path, route, options)
  }

  put<Path extends string>(path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    this.add('PUT', path, route, options)
  }

  patch<Path extends string>(path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    this.add('PATCH', path, route, options)
  }

  delete<Path extends string>(path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    this.add('DELETE', path, route, options)
  }

  /**
   * Routes under `prefix` that go through `middleware` first, after the session is
   * checked: the place to resolve what the prefix names (a workspace) once for all of
   * them, and to refuse who may not.
   */
  group<Prefix extends string>(prefix: Prefix, middleware: Middleware<Prefix>): HttpGroup<Prefix> {
    return new HttpGroup(this, prefix, middleware)
  }

  /** The table for `Bun.serve({ routes })`. Anything else under the prefix is a 404, never the frontend. */
  routes(): Bun.Serve.Routes<undefined, string> {
    const routes: Record<string, Record<HttpMethod, ReturnType<typeof handle>> | ReturnType<typeof handle>> = {}

    for (const [path, byMethod] of this.table) {
      const notAllowed = handle(request => {
        throw new MethodNotAllowed(request.method, path)
      })
      routes[path] = Object.fromEntries(
        METHODS.map(method => [method, byMethod.has(method) ? handle(byMethod.get(method)!) : notAllowed]),
      ) as Record<HttpMethod, ReturnType<typeof handle>>
    }

    routes[`${this.prefix}/*`] = handle(request => {
      throw new ApiRouteNotFound(request.method, new URL(request.url).pathname)
    })
    return routes as Bun.Serve.Routes<undefined, string>
  }

  private add<Path extends string>(method: HttpMethod, path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    const fullPath = `${this.prefix}${path}`
    const byMethod = this.table.get(fullPath) ?? new Map<HttpMethod, HttpRoute>()
    if (byMethod.has(method)) throw new Error(`Route ${method} ${fullPath} is registered twice`)
    const any = route as unknown as HttpRoute
    byMethod.set(method, options?.public ? any : this.signedIn(any))
    this.table.set(fullPath, byMethod)
  }

  private signedIn(route: HttpRoute): HttpRoute {
    return async (request: BunRequest) => {
      const actor = this.authenticator ? await this.authenticator(request) : null
      if (!actor) throw new NotSignedIn()
      return runAsActor(actor, () => route(request))
    }
  }
}
