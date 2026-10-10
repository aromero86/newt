import { UnauthorizedError } from '../../../core/errors/unauthorized-error'

/** The same answer for an unknown account and a wrong password: it reveals nothing. */
export class InvalidCredentials extends UnauthorizedError {
  readonly code = 'authSession.invalid_credentials'
  constructor() {
    super('The nick or email and password do not match')
  }
}
