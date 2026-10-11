import { NotFoundError } from '../../../core/errors/not-found-error'

export class DiscussionCommentNotFound extends NotFoundError {
  readonly code = 'discussionComment.not_found'
  constructor(id: string) {
    super(`Comment ${id} not found`)
  }
}
