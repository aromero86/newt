import { UnauthorizedError } from 'newt-kit/core'

/** The same answer for an unknown email and a wrong password: it tells nobody which accounts exist. */
export class InvalidCredentials extends UnauthorizedError {
  readonly code = 'session.invalid_credentials'
  constructor() {
    super('The email and the password do not match')
  }
}
