import { ForbiddenError } from '../../../core/errors/forbidden-error'

export class DiscussionCommentNotYours extends ForbiddenError {
  readonly code = 'discussionComment.not_yours'
  constructor() {
    super('Only its author edits a comment')
  }
}
