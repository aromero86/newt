import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'

export interface Member_Deps {
  /** auth keeps the workspaces (its tenants of `cooper`), who has access to each, and who they are. */
  auth: {
    access: Access_Module
    tenant: Tenant_Module
    user: User_Module
  }
}
