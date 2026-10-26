import { ConflictError } from '../../core'
import { message } from '../../core/internal'

/** A request whose `Idempotency-Key` another one sent first, still in progress. */
export class IdempotencyKeyInUse extends ConflictError {
  readonly code = 'idempotency_key_in_use'
  constructor() {
    super(message('idempotency_key_in_use'))
  }
}
