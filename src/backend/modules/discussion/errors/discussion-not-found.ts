import { NotFoundError } from '../../../core/errors/not-found-error'

export class DiscussionNotFound extends NotFoundError {
  readonly code = 'discussion.not_found'
  constructor(id: string) {
    super(`Discussion ${id} not found`)
  }
}
