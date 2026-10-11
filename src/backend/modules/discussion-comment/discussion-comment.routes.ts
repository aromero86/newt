import type { Base } from '../../base/base'
import type { DiscussionCommentInputDTO } from './discussion-comment'
import type { DiscussionComment_Module } from './discussion-comment.module'

export function registerDiscussionCommentRoutes(base: Base, comments: DiscussionComment_Module) {
  // Writing and reading comments goes through their conversation; here, only editing one's own.
  base.http.patch('/workspaces/:workspaceId/discussion-comments/:commentId', async request =>
    Response.json(await comments.edit(request.params.workspaceId!, request.params.commentId!, (await request.json()) as DiscussionCommentInputDTO)))
}
