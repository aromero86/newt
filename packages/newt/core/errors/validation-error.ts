import { DomainError } from './domain-error'

export abstract class ValidationError extends DomainError {
  readonly status = 400
}
