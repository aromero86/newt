import { ZodError } from 'zod'
import { DomainError } from '../core'
import { message } from '../core/internal'

/**
 * What a client receives when a request fails: `{ error, code }` with the status the
 * domain error's base class decides. Anything unexpected is a 500 that says nothing
 * about the inside.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (error instanceof ZodError) {
    return Response.json({ error: message('validation'), code: 'validation', issues: error.issues }, { status: 400 })
  }
  console.error('[http] unexpected error', error)
  return Response.json({ error: message('internal'), code: 'internal' }, { status: 500 })
}
