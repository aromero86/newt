import type { Dimension_Module } from '../dimension/dimension.module'
import type { Feature_Module } from '../feature/feature.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Rule_Deps {
  dimension: Dimension_Module
  feature: Feature_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
