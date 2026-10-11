import type { Dimension_Module } from '../dimension/dimension.module'
import type { FeatureArea_Module } from '../feature-area/feature-area.module'
import type { Feature_Module } from '../feature/feature.module'
import type { Rule_Module } from '../rule/rule.module'
import type { User_Module } from '../user/user.module'

export interface Delta_Deps {
  dimension: Dimension_Module
  feature: Feature_Module
  featureArea: FeatureArea_Module
  rule: Rule_Module
  user: User_Module
}
