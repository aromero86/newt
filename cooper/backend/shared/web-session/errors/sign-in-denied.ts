import { ForbiddenError } from 'newt-kit/core'

/** auth sent the browser back with no code: the person said no, or may not enter. */
export class SignInDenied extends ForbiddenError {
  readonly code = 'session.sign_in_denied'
  constructor(reason: string) {
    super(`The sign-in did not finish: ${reason}`)
  }
}
