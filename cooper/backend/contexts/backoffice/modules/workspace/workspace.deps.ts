import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'
import type { Board_Module } from '../../../boards/modules/board/board.module'
import type { Card_Module } from '../../../boards/modules/card/card.module'
import type { Staff_Module } from '../staff/staff.module'

/**
 * What a workspace's page is made of, each part asked to the module that keeps it:
 * auth's tenants, accesses and accounts, and boards' boards and cards. Only their use
 * cases, never their repositories.
 */
export interface Workspace_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  tenant: Tenant_Module
  access: Access_Module
  user: AuthUser_Module
  board: Board_Module
  /** How many cards each workspace and board has: Kysely's counts, in boards. */
  card: Card_Module
}
