import { UnauthorizedError } from 'newt/core'

/** auth would not trade the code, or its token said nothing of this app. */
export class SignInFailed extends UnauthorizedError {
  readonly code = 'session.sign_in_failed'
  constructor(reason: string) {
    super(`The sign-in failed: ${reason}`)
  }
}
