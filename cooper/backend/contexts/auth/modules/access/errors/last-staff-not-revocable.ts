import { ConflictError } from 'newt/core'

/** A product keeps someone of the staff: the last one, or someone taken away meanwhile, revokes no one. */
export class LastStaffNotRevocable extends ConflictError {
  readonly code = 'access.last_staff_not_revocable'
  constructor(productId: string) {
    super(`The staff of ${productId} cannot be left without anyone who manages it`)
  }
}
