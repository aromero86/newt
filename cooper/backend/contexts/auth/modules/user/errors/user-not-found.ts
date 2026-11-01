import { NotFoundError } from '@newt-kit/newt/core'

export class UserNotFound extends NotFoundError {
  readonly code = 'user.not_found'
  constructor(id: string) {
    super(`There is no user ${id}`)
  }
}
