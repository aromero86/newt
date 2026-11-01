import { ZodError } from 'zod'
import { DomainError } from '../core'
import { message } from '../core/internal'
import { MalformedBody } from './errors/malformed-body'
import { MethodNotAllowed } from './errors/method-not-allowed'
import { retryAfter } from './to-error-response'

/**
 * What an OAuth client receives when a request fails: `{ error, error_description }`
 * (RFC 6749 §5.2), not the API's `{ error, code }`. `codes` names the OAuth error of each
 * domain error code; anything else that is the request's fault is `fallback`, but a
 * method the endpoint does not have, which is `invalid_request` whatever the fallback.
 */
export function toOauthErrorResponse(error: unknown, fallback: string, codes: Record<string, string> = {}): Response {
  const answer = (status: number, code: string, description: string) =>
    Response.json({ error: code, error_description: description }, { status, headers: { 'cache-control': 'no-store', ...retryAfter(error) } })

  // A body that is not JSON (read raw, or inside `handle`) or not a form (read inside `handle`,
  // whatever Bun throws for it). Any other TypeError is a bug of the server's own, a 500 like the rest.
  if (error instanceof SyntaxError || error instanceof MalformedBody) return answer(400, fallback, message('validation'))
  if (error instanceof MethodNotAllowed) return answer(error.status, codes[error.code] ?? 'invalid_request', error.message)
  if (error instanceof DomainError) return answer(error.status, codes[error.code] ?? fallback, error.message)
  if (error instanceof ZodError) return answer(400, fallback, error.issues[0]?.message ?? message('validation'))
  console.error('[oauth] unexpected error', error)
  return answer(500, 'server_error', message('internal'))
}
