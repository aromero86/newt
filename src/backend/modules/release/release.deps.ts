import type { Baseline_Module } from '../baseline/baseline.module'
import type { Dimension_Module } from '../dimension/dimension.module'
import type { FeatureArea_Module } from '../feature-area/feature-area.module'
import type { Feature_Module } from '../feature/feature.module'
import type { Rule_Module } from '../rule/rule.module'
import type { User_Module } from '../user/user.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Release_Deps {
  baseline: Baseline_Module
  dimension: Dimension_Module
  feature: Feature_Module
  featureArea: FeatureArea_Module
  rule: Rule_Module
  user: User_Module
  workspace: Workspace_Module
  workspaceMember: WorkspaceMember_Module
}
