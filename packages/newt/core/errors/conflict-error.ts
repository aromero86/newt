import { DomainError } from './domain-error'

export abstract class ConflictError extends DomainError {
  readonly status = 409
}
