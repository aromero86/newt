import { DomainError } from '../errors/domain-error'

/**
 * How a call that threw ended: an `error`, one it says may happen (a domain error under
 * 500, `card.not_found`; a validation), or a `failure`, one nobody expected (a 5xx
 * domain error, a `TypeError`, a database gone), by its code or else its class.
 */
export type Outcome = { kind: 'error' | 'failure', code: string }

export function outcomeOf(error: unknown): Outcome {
  if (error instanceof DomainError) return { kind: error.status < 500 ? 'error' : 'failure', code: error.code }
  // Zod's, which a use case throws parsing what it is given: the router answers it a 400.
  if (error instanceof Error && error.name === 'ZodError') return { kind: 'error', code: 'validation' }
  return { kind: 'failure', code: error instanceof Error ? error.name : typeof error }
}
