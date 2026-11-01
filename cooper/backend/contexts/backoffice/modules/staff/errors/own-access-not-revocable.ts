import { ForbiddenError } from 'newt-kit/core'

/** Someone of the staff taking their own access away: another one does it, so the backoffice is never left without staff. */
export class OwnAccessNotRevocable extends ForbiddenError {
  readonly code = 'staff.own_access_not_revocable'
  constructor() {
    super('You cannot take away your own access: someone else of the staff can')
  }
}
