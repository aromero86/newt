import { ForbiddenError } from '@newt-kit/newt/core'

/** The product someone is on the way to lets in only whom it was told: no account is made for it. */
export class SignUpClosed extends ForbiddenError {
  readonly code = 'session.sign_up_closed'
  constructor(productName: string) {
    super(`${productName} does not take new accounts: ask someone who runs it for access`)
  }
}
