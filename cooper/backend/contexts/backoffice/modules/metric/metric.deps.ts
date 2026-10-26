import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
import type { Card_Module } from '../../../boards/modules/card/card.module'
import type { Staff_Module } from '../staff/staff.module'

/** The modules whose events the metrics count, in auth and boards; and the staff, for the routes. */
export interface Metric_Deps {
  staff: Staff_Module
  /** `card.created`. */
  card: Card_Module
  /** `tenant.created`: a new workspace. */
  tenant: Tenant_Module
  /** `user.signedUp`. */
  user: AuthUser_Module
}
