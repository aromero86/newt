import { ZodError } from 'zod'
import { DomainError, type ErrorBody } from '../core'
import { message } from '../core/internal'

/**
 * What a client receives when a request fails: `{ error, code }` with the status the
 * domain error's base class decides. Anything unexpected is a 500 that says nothing
 * about the inside.
 */
export function toErrorResponse(error: unknown): Response {
  const answer = (status: number, body: ErrorBody) => Response.json(body, { status })
  if (error instanceof DomainError) return answer(error.status, { error: error.message, code: error.code })
  if (error instanceof ZodError) return answer(400, { error: message('validation'), code: 'validation', issues: error.issues })
  console.error('[http] unexpected error', error)
  return answer(500, { error: message('internal'), code: 'internal' })
}
