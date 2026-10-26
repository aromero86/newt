import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
import type { Staff_Module } from '../staff/staff.module'

export interface User_Deps {
  /** That who asks is of the staff, before any route answers; and whether an account is. */
  staff: Staff_Module
  /** auth's accounts, which this module shows: it keeps none. */
  user: AuthUser_Module
  /** The workspaces someone may enter. */
  access: Access_Module
  /** Those workspaces' names. */
  tenant: Tenant_Module
}
