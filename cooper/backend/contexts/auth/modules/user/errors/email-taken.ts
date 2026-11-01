import { ConflictError } from 'newt-kit/core'

/** Another account has this email, whatever its case. */
export class EmailTaken extends ConflictError {
  readonly code = 'user.email_taken'
  constructor() {
    super('There is an account with this email already: sign in instead')
  }
}
