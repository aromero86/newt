import { NotFoundError } from '@newt-kit/newt/core'

export class AvatarNotFound extends NotFoundError {
  readonly code = 'avatar.not_found'
  constructor(id: string) {
    super(`There is no picture ${id}`)
  }
}
