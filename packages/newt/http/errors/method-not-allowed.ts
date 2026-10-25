import { DomainError } from '../../core'
import { message } from '../../core/internal'

export class MethodNotAllowed extends DomainError {
  readonly status = 405
  readonly code = 'method_not_allowed'
  constructor(method: string, path: string) {
    super(message('method_not_allowed', { method, path }))
  }
}
