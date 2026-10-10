import type { BunRequest } from 'bun'
import type { HttpRoute } from './http-route'
import { toErrorResponse } from './to-error-response'

/** Wraps a route so that whatever it throws becomes an error response. */
export function handle(route: HttpRoute) {
  return async (request: BunRequest): Promise<Response> => {
    try {
      return await route(request)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}
