import { ZodError } from 'zod'
import { DomainError, TooManyRequests, type ErrorBody } from '../core'
import { message } from '../core/internal'

/**
 * What a client receives when a request fails: `{ error, code }` with the status the
 * domain error's base class decides. Anything unexpected is a 500 that says nothing
 * about the inside. One who ran into a rate limit is told when to try again (`Retry-After`).
 */
export function toErrorResponse(error: unknown): Response {
  const answer = (status: number, body: ErrorBody) => Response.json(body, { status, headers: retryAfter(error) })
  if (error instanceof DomainError) return answer(error.status, { error: error.message, code: error.code })
  if (error instanceof ZodError) return answer(400, { error: message('validation'), code: 'validation', issues: error.issues })
  console.error('[http] unexpected error', error)
  return answer(500, { error: message('internal'), code: 'internal' })
}

/** When to try again, for one who ran into a rate limit: whole seconds, rounded up. */
export function retryAfter(error: unknown): Record<string, string> {
  return error instanceof TooManyRequests ? { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) } : {}
}
