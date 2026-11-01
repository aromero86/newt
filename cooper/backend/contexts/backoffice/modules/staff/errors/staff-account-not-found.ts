import { NotFoundError } from 'newt-kit/core'

/** Nobody has an account with the email given: they sign up in auth first. */
export class StaffAccountNotFound extends NotFoundError {
  readonly code = 'staff.account_not_found'
  constructor(email: string) {
    super(`No account has the email ${email}: they sign up first`)
  }
}
