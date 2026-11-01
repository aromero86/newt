import type { BunRequest } from 'bun'
import type { ErrorHandler } from './error-handler'
import { MalformedBody } from './errors/malformed-body'
import { PayloadTooLarge } from './errors/payload-too-large'
import { UnsupportedMediaType } from './errors/unsupported-media-type'
import type { HttpRoute } from './http-route'
import { toErrorResponse } from './to-error-response'

/**
 * Wraps a route so that whatever it throws becomes an error response, `onError`'s
 * (`toErrorResponse` unless told). A body that cannot be read as JSON or as a form is
 * the client's fault: a 400 (`malformed_body`), not a 500. A body read as JSON must
 * say it is JSON, or it is a 415 (`unsupported_media_type`): a form posted from
 * another site cannot say so. A body longer than `maxBodyBytes`, when given, is a 413
 * (`payload_too_large`): before the route runs when its length is told, as it is read
 * when it is not.
 */
export function handle(route: HttpRoute, onError: ErrorHandler = toErrorResponse, maxBodyBytes?: number) {
  return async (request: BunRequest): Promise<Response> => {
    try {
      if (maxBodyBytes !== undefined) limitBody(request, maxBodyBytes)
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
          // Bun rejects a broken form with a TypeError or a plain Error, by what is broken.
          return formData().catch(error => { throw error instanceof PayloadTooLarge ? error : new MalformedBody(error) })
        },
      })
      return await route(request)
    } catch (error) {
      return onError(error, request)
    }
  }
}

/**
 * Makes a request's body refuse to be longer than `max`: at once when its length says
 * so, and, sent without a length, as it is read, whichever way the route reads it.
 */
function limitBody(request: BunRequest, max: number): void {
  const length = Number(request.headers.get('content-length') ?? '')
  if (length > max) throw new PayloadTooLarge(max)
  if (request.headers.has('content-length') || !request.body) return

  let read: Promise<Uint8Array<ArrayBuffer>> | null = null
  const bytes = () => (read ??= readUpTo(request.body!, max))
  const contentType = request.headers.get('content-type') ?? ''
  const as = (body: Uint8Array<ArrayBuffer>) => new Response(body, { headers: { 'content-type': contentType } })
  const methods = {
    bytes,
    arrayBuffer: async () => (await bytes()).buffer,
    text: async () => new TextDecoder().decode(await bytes()),
    json: async () => JSON.parse(new TextDecoder().decode(await bytes())) as unknown,
    blob: async () => as(await bytes()).blob(),
    formData: async () => as(await bytes()).formData(),
  }
  for (const [name, value] of Object.entries(methods)) Object.defineProperty(request, name, { value, configurable: true })
}

/** A stream's bytes, refused once they pass `max`. */
async function readUpTo(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > max) throw new PayloadTooLarge(max)
    chunks.push(chunk)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return all
}

/** `application/json`, or a type built on it such as `application/merge-patch+json`. */
function isJson(contentType: string | null): boolean {
  const type = contentType?.split(';')[0]!.trim().toLowerCase() ?? ''
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'))
}
