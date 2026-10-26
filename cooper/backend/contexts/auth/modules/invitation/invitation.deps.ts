import type { Access_Module } from '../access/access.module'
import type { Tenant_Module } from '../tenant/tenant.module'
import type { User_Module } from '../user/user.module'

export interface Invitation_Deps {
  tenant: Tenant_Module
  access: Access_Module
  user: User_Module
}
