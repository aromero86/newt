import { NotFoundError } from '@newt-kit/newt/core'

export class AccessNotFound extends NotFoundError {
  readonly code = 'access.not_found'
  constructor() {
    super('This person has no such access')
  }
}
