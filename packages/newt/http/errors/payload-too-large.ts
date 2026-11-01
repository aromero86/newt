import { DomainError } from '../../core'
import { message } from '../../core/internal'

/** A request whose body is longer than its route takes (`maxBodyBytes`): a 413. */
export class PayloadTooLarge extends DomainError {
  readonly status = 413
  readonly code = 'payload_too_large'
  constructor(readonly maxBytes: number) {
    super(message('payload_too_large', { maxBytes }))
  }
}
