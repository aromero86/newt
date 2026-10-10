import type { Mail_Module } from '../mail/mail.module'
import type { User_Module } from '../user/user.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface WorkspaceInvitation_Deps {
  user: User_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
  mail: Mail_Module
}
