import { DomainError } from './domain-error'

/** Whoever asks is signed in, but may not do this. */
export abstract class ForbiddenError extends DomainError {
  readonly status = 403
}
