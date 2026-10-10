import { ZodError } from 'zod'
import { DomainError } from '../../core/errors/domain-error'

/**
 * What the frontend receives when a request fails: `{ error, code }` with the status the
 * domain error's base class decides. Anything unexpected is a 500 that says nothing
 * about the inside.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (error instanceof ZodError) {
    return Response.json({ error: 'The request is not valid', code: 'validation', issues: error.issues }, { status: 400 })
  }
  console.error('[api] unexpected error', error)
  return Response.json({ error: 'Something went wrong', code: 'internal' }, { status: 500 })
}
