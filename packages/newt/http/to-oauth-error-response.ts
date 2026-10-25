import { ZodError } from 'zod'
import { DomainError } from '../core'
import { message } from '../core/internal'

/**
 * What an OAuth client receives when a request fails: `{ error, error_description }`
 * (RFC 6749 §5.2), not the API's `{ error, code }`. `codes` names the OAuth error of each
 * domain error code; anything else that is the request's fault is `fallback`.
 */
export function toOauthErrorResponse(error: unknown, fallback: string, codes: Record<string, string> = {}): Response {
  const answer = (status: number, code: string, description: string) =>
    Response.json({ error: code, error_description: description }, { status, headers: { 'cache-control': 'no-store' } })

  if (error instanceof DomainError) return answer(error.status, codes[error.code] ?? fallback, error.message)
  if (error instanceof ZodError) return answer(400, fallback, error.issues[0]?.message ?? message('validation'))
  // A body that is not JSON or not a form.
  if (error instanceof SyntaxError || error instanceof TypeError) return answer(400, fallback, message('validation'))
  console.error('[oauth] unexpected error', error)
  return answer(500, 'server_error', message('internal'))
}
