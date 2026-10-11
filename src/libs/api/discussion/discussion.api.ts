import type { DiscussionCommentDTO } from '../../../backend/modules/discussion-comment/discussion-comment.schema'
import type { DiscussionCounts, DiscussionDTO } from '../../../backend/modules/discussion/discussion.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `discussion` module: the conversations on a proposal and its deltas. */
export class DiscussionApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the conversations on the proposal in general, or on one delta. */
  list(workspaceId: string, key: string, deltaId?: string, page?: PageRequest) {
    return this.get<Page<DiscussionDTO>>(`/${workspaceId}/proposals/${key}/discussions`, { ...page, deltaId })
  }

  /** How many conversations each delta has, and the proposal in general under ''. */
  counts(workspaceId: string, key: string) {
    return this.get<Record<string, DiscussionCounts>>(`/${workspaceId}/proposals/${key}/discussions/counts`)
  }

  start(workspaceId: string, key: string, body: string, deltaId?: string) {
    return this.post<DiscussionDTO>(`/${workspaceId}/proposals/${key}/discussions`, { body, deltaId })
  }

  /** A page of what was said in a conversation, oldest first. */
  comments(workspaceId: string, discussionId: string, page?: PageRequest) {
    return this.get<Page<DiscussionCommentDTO>>(`/${workspaceId}/discussions/${discussionId}/comments`, page)
  }

  reply(workspaceId: string, discussionId: string, body: string) {
    return this.post<DiscussionCommentDTO>(`/${workspaceId}/discussions/${discussionId}/comments`, { body })
  }

  resolveDiscussion(workspaceId: string, discussionId: string) {
    return this.post<DiscussionDTO>(`/${workspaceId}/discussions/${discussionId}/resolve`)
  }

  reopen(workspaceId: string, discussionId: string) {
    return this.post<DiscussionDTO>(`/${workspaceId}/discussions/${discussionId}/reopen`)
  }
}
