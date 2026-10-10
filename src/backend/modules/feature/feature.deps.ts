import type { FeatureArea_Module } from '../feature-area/feature-area.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Feature_Deps {
  featureArea: FeatureArea_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
