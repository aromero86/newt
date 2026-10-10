import type { BunRequest } from 'bun'
import { runAsActor } from '../../core/context/run-as-actor'
import type { Authenticator } from './authenticator'
import { ApiRouteNotFound } from './errors/api-route-not-found'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { NotSignedIn } from './errors/not-signed-in'
import { handle } from './handle'
import type { HttpMethod } from './http-method'
import type { HttpRoute } from './http-route'
import type { RouteOptions } from './route-options'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * The HTTP entry for the frontend, under `/api`. Each module registers its own
 * routes here from its `<m>.routes.ts`; the server takes the whole table.
 *
 * Every route needs a session unless it is registered as public. A signed-in
 * request runs as its actor, so every use case it calls knows who is doing it.
 */
export class HttpRouter {

  private readonly table = new Map<string, Map<HttpMethod, HttpRoute>>()
  private authenticator: Authenticator | null = null

  /** Set by the module that knows the sessions. */
  authenticateWith(authenticator: Authenticator): void {
    this.authenticator = authenticator
  }

  get(path: string, route: HttpRoute, options?: RouteOptions): void {
    this.add('GET', path, route, options)
  }

  post(path: string, route: HttpRoute, options?: RouteOptions): void {
    this.add('POST', path, route, options)
  }

  put(path: string, route: HttpRoute, options?: RouteOptions): void {
    this.add('PUT', path, route, options)
  }

  patch(path: string, route: HttpRoute, options?: RouteOptions): void {
    this.add('PATCH', path, route, options)
  }

  delete(path: string, route: HttpRoute, options?: RouteOptions): void {
    this.add('DELETE', path, route, options)
  }

  /** The table for `Bun.serve({ routes })`. Anything else under /api is a 404, never the frontend. */
  routes() {
    const routes: Record<string, Record<HttpMethod, ReturnType<typeof handle>> | ReturnType<typeof handle>> = {}

    for (const [path, byMethod] of this.table) {
      const notAllowed = handle(request => {
        throw new MethodNotAllowed(request.method, path)
      })
      routes[path] = Object.fromEntries(
        METHODS.map(method => [method, byMethod.has(method) ? handle(byMethod.get(method)!) : notAllowed]),
      ) as Record<HttpMethod, ReturnType<typeof handle>>
    }

    routes['/api/*'] = handle(request => {
      throw new ApiRouteNotFound(request.method, new URL(request.url).pathname)
    })
    return routes
  }

  private add(method: HttpMethod, path: string, route: HttpRoute, options?: RouteOptions): void {
    const fullPath = `/api${path}`
    const byMethod = this.table.get(fullPath) ?? new Map<HttpMethod, HttpRoute>()
    if (byMethod.has(method)) throw new Error(`Route ${method} ${fullPath} is registered twice`)
    byMethod.set(method, options?.public ? route : this.signedIn(route))
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
