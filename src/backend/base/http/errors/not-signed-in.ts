import { UnauthorizedError } from '../../../core/errors/unauthorized-error'

export class NotSignedIn extends UnauthorizedError {
  readonly code = 'auth.not_signed_in'
  constructor() {
    super('Sign in to continue')
  }
}
