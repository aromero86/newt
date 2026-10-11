import { NotFoundError } from '../../../core/errors/not-found-error'

export class AuthTokenNotFound extends NotFoundError {
  readonly code = 'authToken.not_found'
  constructor(id: string) {
    super(`Access token ${id} not found`)
  }
}
