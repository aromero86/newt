import { DomainError } from '../../core'
import { message } from '../../core/internal'

/** A request whose `Idempotency-Key` was sent before with another body. */
export class IdempotencyKeyReused extends DomainError {
  readonly status = 422
  readonly code = 'idempotency_key_reused'
  constructor() {
    super(message('idempotency_key_reused'))
  }
}
