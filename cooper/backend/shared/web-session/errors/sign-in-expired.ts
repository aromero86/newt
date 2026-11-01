import { ValidationError } from '@newt-kit/newt/core'

/** The browser came back without the sign-in it started here, or with another one's state. */
export class SignInExpired extends ValidationError {
  readonly code = 'session.sign_in_expired'
  constructor() {
    super('The sign-in took too long or was started elsewhere: sign in again')
  }
}
