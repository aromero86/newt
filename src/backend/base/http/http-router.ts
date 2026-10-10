import { ApiRouteNotFound } from './errors/api-route-not-found'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { handle } from './handle'
import type { HttpMethod } from './http-method'
import type { HttpRoute } from './http-route'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * The HTTP entry for the frontend, under `/api`. Each module registers its own
 * routes here from its `<m>.routes.ts`; the server takes the whole table.
 */
export class HttpRouter {

  private readonly table = new Map<string, Map<HttpMethod, HttpRoute>>()

  get(path: string, route: HttpRoute): void {
    this.add('GET', path, route)
  }

  post(path: string, route: HttpRoute): void {
    this.add('POST', path, route)
  }

  put(path: string, route: HttpRoute): void {
    this.add('PUT', path, route)
  }

  patch(path: string, route: HttpRoute): void {
    this.add('PATCH', path, route)
  }

  delete(path: string, route: HttpRoute): void {
    this.add('DELETE', path, route)
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

  private add(method: HttpMethod, path: string, route: HttpRoute): void {
    const fullPath = `/api${path}`
    const byMethod = this.table.get(fullPath) ?? new Map<HttpMethod, HttpRoute>()
    if (byMethod.has(method)) throw new Error(`Route ${method} ${fullPath} is registered twice`)
    byMethod.set(method, route)
    this.table.set(fullPath, byMethod)
  }
}
