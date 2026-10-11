import type { User_Module } from '../user/user.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface DiscussionComment_Deps {
  user: User_Module
  workspace: Workspace_Module
}
