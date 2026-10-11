import type { Delta_Module } from '../delta/delta.module'
import type { Dimension_Module } from '../dimension/dimension.module'
import type { FeatureArea_Module } from '../feature-area/feature-area.module'
import type { Feature_Module } from '../feature/feature.module'
import type { Proposal_Module } from '../proposal/proposal.module'
import type { Rule_Module } from '../rule/rule.module'
import type { WorkspaceMember_Module } from '../workspace-member/workspace-member.module'

export interface Search_Deps {
  delta: Delta_Module
  dimension: Dimension_Module
  feature: Feature_Module
  featureArea: FeatureArea_Module
  proposal: Proposal_Module
  rule: Rule_Module
  workspaceMember: WorkspaceMember_Module
}
