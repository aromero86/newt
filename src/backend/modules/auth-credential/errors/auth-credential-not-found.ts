import { NotFoundError } from '../../../core/errors/not-found-error'

export class AuthCredentialNotFound extends NotFoundError {
  readonly code = 'authCredential.not_found'
  constructor(userId: string) {
    super(`User ${userId} has no password`)
  }
}
