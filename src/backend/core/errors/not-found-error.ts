import { DomainError } from './domain-error'

export abstract class NotFoundError extends DomainError {
  readonly status = 404
}
