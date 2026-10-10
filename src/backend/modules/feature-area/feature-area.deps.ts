import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface FeatureArea_Deps {
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
