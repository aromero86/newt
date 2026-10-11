import type { DiscussionCommentDTO } from '../../../backend/modules/discussion-comment/discussion-comment.schema'
import { Requester } from '../core/requester'

/** The backend's `discussion-comment` module: editing one's own comments. */
export class DiscussionCommentApi extends Requester {
  protected readonly path = '/workspaces'

  edit(workspaceId: string, commentId: string, body: string) {
    return this.patch<DiscussionCommentDTO>(`/${workspaceId}/discussion-comments/${commentId}`, { body })
  }
}
