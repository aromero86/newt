import { DomainError } from '../../../core/errors/domain-error'

export class MethodNotAllowed extends DomainError {
  readonly status = 405
  readonly code = 'api.method_not_allowed'
  constructor(method: string, path: string) {
    super(`${method} is not allowed on ${path}`)
  }
}
