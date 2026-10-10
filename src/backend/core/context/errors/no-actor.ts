import { UnauthorizedError } from '../../errors/unauthorized-error'

export class NoActor extends UnauthorizedError {
  readonly code = 'auth.not_signed_in'
  constructor() {
    super('Sign in to do this')
  }
}
