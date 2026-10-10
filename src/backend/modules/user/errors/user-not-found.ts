import { NotFoundError } from '../../../core/errors/not-found-error'

export class UserNotFound extends NotFoundError {
  readonly code = 'user.not_found'
  constructor(id: string) {
    super(`User ${id} not found`)
  }
}
