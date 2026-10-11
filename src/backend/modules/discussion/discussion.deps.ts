import type { DiscussionComment_Module } from '../discussion-comment/discussion-comment.module'
import type { Proposal_Module } from '../proposal/proposal.module'
import type { User_Module } from '../user/user.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Discussion_Deps {
  discussionComment: DiscussionComment_Module
  proposal: Proposal_Module
  user: User_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
