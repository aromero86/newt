import type { BunRequest } from 'bun'
import { runAsActor } from '../core'
import { applicationTracer, traceRoot } from '../core/internal'
import type { Authenticator } from './authenticator'
import type { Cors } from './cors'
import { corsHeaders } from './cors-headers'
import { ApiRouteNotFound } from './errors/api-route-not-found'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { NotSignedIn } from './errors/not-signed-in'
import { handle } from './handle'
import { HttpGroup } from './http-group'
import { idempotent } from './idempotent'
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

/** A route as the table keeps it: guarded, with its params by its own names, and its options. */
type Registered = { route: HttpRoute, options: RouteOptions }

type Answer = (request: BunRequest) => Promise<Response>

/**
 * A context's HTTP entry. Each module registers its own routes on it, and the server
 * takes the whole table (`serve`). Whatever a route throws becomes an error response.
 *
 * Every route needs a session unless it is registered as public. A signed-in
 * request runs as its actor, so every use case it calls knows who is doing it.
 *
 * Each request is a span of the application's tracer (`setTracer`), `GET /api/things/:id`,
 * which the use cases it calls are inside of, in whatever context.
 *
 * A context may have more than one: its API under `/api`, and another at the root
 * for addresses with a format of their own (OAuth's, with its own `onError`).
 */
export class HttpRouter {

  /** By shape: the path Bun is given (the first one registered), and each method's route. */
  private readonly table = new Map<string, { path: string, byMethod: Map<HttpMethod, Registered> }>()
  private readonly prefix: string
  /** What every route has unless it says otherwise. */
  private readonly defaults: RouteOptions
  private authenticator: Authenticator | null = null

  constructor({ prefix, ...defaults }: HttpRouterOptions = {}) {
    this.prefix = prefix ?? '/api'
    this.defaults = defaults
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
   * them, and to refuse who may not. `options` are each route's unless it says otherwise.
   */
  group<Prefix extends string>(prefix: Prefix, middleware: Middleware<Prefix>, options?: RouteOptions): HttpGroup<Prefix> {
    return new HttpGroup(this, prefix, middleware, options)
  }

  /**
   * The table for `Bun.serve({ routes })`. Anything else under the prefix, the prefix
   * itself too, is a 404, never the frontend; at the root (`prefix: ''`) it is the
   * frontend's. Paths are case-sensitive: `/API/things` is not under `/api`, so it is
   * the frontend's. A method a path does not have is a
   * 405 that lists the ones it has in `Allow`; `OPTIONS` too, unless a route of the
   * path takes calls from other origins (`cors`): then it answers their preflight.
   * A 405 is the path's error, so it answers through its first route's `onError`
   * (the first registered on it, whatever the method): an OAuth path in OAuth's format.
   */
  routes(): Bun.Serve.Routes<undefined, string> {
    const routes: Record<string, Record<string, Answer> | Answer> = {}

    for (const { path, byMethod } of this.table.values()) {
      const methods = METHODS.filter(method => byMethod.has(method))
      // The path's, for its preflight and its 405s: the first of its routes that has one.
      const cors = [...byMethod.values()].find(each => each.options.cors)?.options.cors
      // Its 405s' format: its first route's (they are kept in the order they were registered).
      const onError = [...byMethod.values()][0]!.options.onError
      const notAllowed = withCors(handle(request => {
        throw new MethodNotAllowed(request.method, path)
      }, onError), cors)
      const answerNotAllowed = async (request: BunRequest) => {
        const response = await notAllowed(request)
        response.headers.set('allow', methods.join(', '))
        return response
      }
      const preflight = async (request: BunRequest) =>
        new Response(null, { status: 204, headers: corsHeaders(cors!, request, [...methods, 'OPTIONS']) })

      routes[path] = Object.fromEntries([
        ...[...byMethod].map(([method, { route, options }]) => [method, traced(method, path, withCors(handle(route, options.onError), options.cors))]),
        ...METHODS.filter(method => !byMethod.has(method)).map(method => [method, answerNotAllowed]),
        ['OPTIONS', cors ? preflight : answerNotAllowed],
      ])
    }

    // At the root, any other address is the frontend's.
    if (this.prefix === '') return routes as Bun.Serve.Routes<undefined, string>
    const notFound = handle(request => {
      throw new ApiRouteNotFound(request.method, new URL(request.url).pathname)
    }, this.defaults.onError)
    // A route registered at '' is the prefix itself, and one at '/*' all under it: they keep their place.
    routes[this.prefix] ??= notFound
    routes[`${this.prefix}/*`] ??= notFound
    return routes as Bun.Serve.Routes<undefined, string>
  }

  /**
   * Adds a route. Paths that differ only in their params' names are one path to Bun:
   * they share an entry, and each route still sees its params by its own names.
   */
  private add<Path extends string>(method: HttpMethod, path: Path, route: HttpRoute<Path>, own?: RouteOptions): void {
    const fullPath = `${this.prefix}${path}`
    const entry = this.table.get(shapeOf(fullPath)) ?? { path: fullPath, byMethod: new Map<HttpMethod, Registered>() }
    if (entry.byMethod.has(method)) throw new Error(`Route ${method} ${fullPath} is registered twice`)
    const options = { ...this.defaults, ...own }
    const any = route as unknown as HttpRoute
    const once = options.idempotency && method === 'POST' ? idempotent(any, options.idempotency) : any
    const guarded = options.public ? once : this.signedIn(once)
    entry.byMethod.set(method, { route: entry.path === fullPath ? guarded : renamingParams(entry.path, fullPath, guarded), options })
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

/** An answer that says, when `cors` is given, what a page of another origin may read of it. */
function withCors(answer: Answer, cors: Cors | undefined): Answer {
  if (!cors) return answer
  return async request => {
    const response = await answer(request)
    // A Response.redirect's headers cannot change: a copy's can.
    const open = new Response(response.body, response)
    for (const [name, value] of Object.entries(corsHeaders(cors, request))) open.headers.set(name, value)
    return open
  }
}

/**
 * An answer in a span of its own, an error when it is a 5xx: the root of the trace of
 * a request, the application's tracer's and the monitor's (an error under 500, a failure from it).
 */
function traced(method: string, path: string, answer: Answer): Answer {
  const name = `${method} ${path}`
  const outcome = (response: Response) => (response.status >= 500 ? { kind: 'failure' as const, code: `http.${response.status}` } : response.status >= 400 ? { kind: 'error' as const, code: `http.${response.status}` } : null)
  return request => Promise.resolve(traceRoot({ kind: 'http', name }, () => applicationTracer.value.startActiveSpan(name, { 'http.method': method, 'http.route': path }, async span => {
    try {
      const response = await answer(request)
      if (response.status >= 500) span.setError(new Error(`${name} answered ${response.status}`))
      return response
    } finally {
      span.end()
    }
  }), outcome))
}
