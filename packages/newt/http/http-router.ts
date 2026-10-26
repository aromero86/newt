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

/** A path's shape: its params unnamed, so `/things/:id` and `/things/:thingId` are one path. */
const shapeOf = (path: string) => path.replace(/:[^/]+/g, ':')

/** The names of a path's params, in order. */
const paramsOf = (path: string) => path.match(/:[^/]+/g)?.map(param => param.slice(1)) ?? []

/**
 * A context's HTTP entry. Each module registers its own routes on it, and the server
 * takes the whole table (`serve`). Whatever a route throws becomes an error response.
 *
 * Every route needs a session unless it is registered as public. A signed-in
 * request runs as its actor, so every use case it calls knows who is doing it.
 */
export class HttpRouter {

  /** By shape: the path Bun is given (the first one registered), and each method's route. */
  private readonly table = new Map<string, { path: string, byMethod: Map<HttpMethod, HttpRoute> }>()
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

  /**
   * The table for `Bun.serve({ routes })`. Anything else under the prefix, the prefix
   * itself too, is a 404, never the frontend. Paths are case-sensitive: `/API/things`
   * is not under `/api`, so it is the frontend's. A method a path does not have
   * (`OPTIONS` too: there is no CORS) is a 405 that lists the ones it has in `Allow`.
   */
  routes(): Bun.Serve.Routes<undefined, string> {
    const routes: Record<string, Record<string, ReturnType<typeof handle>> | ReturnType<typeof handle>> = {}

    for (const { path, byMethod } of this.table.values()) {
      const allow = METHODS.filter(method => byMethod.has(method)).join(', ')
      const notAllowed = handle(request => {
        throw new MethodNotAllowed(request.method, path)
      })
      const answerNotAllowed = async (request: BunRequest) => {
        const response = await notAllowed(request)
        response.headers.set('allow', allow)
        return response
      }
      routes[path] = Object.fromEntries(
        [...METHODS, 'OPTIONS'].map(method => {
          const route = byMethod.get(method as HttpMethod)
          return [method, route ? handle(route) : answerNotAllowed]
        }),
      )
    }

    const notFound = handle(request => {
      throw new ApiRouteNotFound(request.method, new URL(request.url).pathname)
    })
    // A route registered at '' is the prefix itself: it keeps its place.
    routes[this.prefix] ??= notFound
    routes[`${this.prefix}/*`] = notFound
    return routes as Bun.Serve.Routes<undefined, string>
  }

  /**
   * Adds a route. Paths that differ only in their params' names are one path to Bun:
   * they share an entry, and each route still sees its params by its own names.
   */
  private add<Path extends string>(method: HttpMethod, path: Path, route: HttpRoute<Path>, options?: RouteOptions): void {
    const fullPath = `${this.prefix}${path}`
    const entry = this.table.get(shapeOf(fullPath)) ?? { path: fullPath, byMethod: new Map<HttpMethod, HttpRoute>() }
    if (entry.byMethod.has(method)) throw new Error(`Route ${method} ${fullPath} is registered twice`)
    const any = route as unknown as HttpRoute
    const guarded = options?.public ? any : this.signedIn(any)
    entry.byMethod.set(method, entry.path === fullPath ? guarded : renamingParams(entry.path, fullPath, guarded))
    this.table.set(shapeOf(fullPath), entry)
  }

  private signedIn(route: HttpRoute): HttpRoute {
    return async (request: BunRequest) => {
      const actor = this.authenticator ? await this.authenticator(request) : null
      if (!actor) throw new NotSignedIn()
      return runAsActor(actor, () => route(request))
    }
  }
}

/** A route registered as `own` that Bun reaches through `registered`: it gets its params by its own names. */
function renamingParams(registered: string, own: string, route: HttpRoute): HttpRoute {
  const from = paramsOf(registered)
  const to = paramsOf(own)
  return request => {
    const params = Object.fromEntries(to.map((name, i) => [name, request.params[from[i]!]]))
    Object.defineProperty(request, 'params', { value: params })
    return route(request)
  }
}
