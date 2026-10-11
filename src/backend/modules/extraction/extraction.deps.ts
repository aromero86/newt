import type { Dimension_Module } from '../dimension/dimension.module'
import type { FeatureArea_Module } from '../feature-area/feature-area.module'
import type { Feature_Module } from '../feature/feature.module'
import type { Rule_Module } from '../rule/rule.module'
import type { Workspace_Module } from '../workspace/workspace.module'

export interface Extraction_Deps {
  dimension: Dimension_Module
  feature: Feature_Module
  featureArea: FeatureArea_Module
  rule: Rule_Module
  workspace: Workspace_Module
}
