import { ForbiddenError } from 'newt/core'

/** A member, or someone of the product, who may not manage who enters it. */
export class NotAdmin extends ForbiddenError {
  readonly code = 'access.not_admin'
  constructor() {
    super('Only an admin may do this')
  }
}
