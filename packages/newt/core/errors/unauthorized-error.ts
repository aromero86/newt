import { DomainError } from './domain-error'

/** Whoever asks is not signed in, or their credentials are wrong. */
export abstract class UnauthorizedError extends DomainError {
  readonly status = 401
}
