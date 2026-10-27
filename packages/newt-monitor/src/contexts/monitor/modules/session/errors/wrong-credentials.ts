import { UnauthorizedError } from 'newt/core'

/** A user or a password that is not the monitor's: which of the two, it does not say. */
export class WrongCredentials extends UnauthorizedError {
  readonly code = 'session.wrong_credentials'
  constructor() {
    super('That user and password do not sign in here')
  }
}
