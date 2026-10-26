import type { BunRequest } from 'bun'
import { MalformedBody } from './errors/malformed-body'
import type { HttpRoute } from './http-route'
import { toErrorResponse } from './to-error-response'

/**
 * Wraps a route so that whatever it throws becomes an error response. A body that
 * cannot be read as JSON is the client's fault: a 400 (`malformed_body`), not a 500.
 */
export function handle(route: HttpRoute) {
  return async (request: BunRequest): Promise<Response> => {
    const json = request.json.bind(request)
    Object.defineProperty(request, 'json', {
      // Only bad JSON is the client's: a body read twice is the route's own mistake.
      value: () => json().catch(error => { throw error instanceof SyntaxError ? new MalformedBody(error) : error }),
    })
    try {
      return await route(request)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}
