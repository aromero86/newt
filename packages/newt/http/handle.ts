import type { BunRequest } from 'bun'
import { MalformedBody } from './errors/malformed-body'
import { UnsupportedMediaType } from './errors/unsupported-media-type'
import type { HttpRoute } from './http-route'
import { toErrorResponse } from './to-error-response'

/**
 * Wraps a route so that whatever it throws becomes an error response. A body that
 * cannot be read as JSON or as a form is the client's fault: a 400 (`malformed_body`),
 * not a 500. A body read as JSON must say it is JSON, or it is a 415
 * (`unsupported_media_type`): a form posted from another site cannot say so.
 */
export function handle(route: HttpRoute) {
  return async (request: BunRequest): Promise<Response> => {
    const json = request.json.bind(request)
    const formData = request.formData.bind(request)
    // Only a bad body is the client's: a body read twice is the route's own mistake.
    Object.defineProperty(request, 'json', {
      value: async () => {
        if (!isJson(request.headers.get('content-type'))) throw new UnsupportedMediaType()
        return json().catch(error => { throw error instanceof SyntaxError ? new MalformedBody(error) : error })
      },
    })
    Object.defineProperty(request, 'formData', {
      value: async () => {
        if (request.bodyUsed) return formData()
        return formData().catch(error => { throw error instanceof TypeError ? new MalformedBody(error) : error })
      },
    })
    try {
      return await route(request)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

/** `application/json`, or a type built on it such as `application/merge-patch+json`. */
function isJson(contentType: string | null): boolean {
  const type = contentType?.split(';')[0]!.trim().toLowerCase() ?? ''
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'))
}
