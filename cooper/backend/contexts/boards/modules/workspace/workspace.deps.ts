import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { Invitation_Module } from '../../../auth/modules/invitation/invitation.module'
import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { User_Module } from '../../../auth/modules/user/user.module'
import type { Board_Module } from '../board/board.module'
import type { Card_Module } from '../card/card.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * auth's modules, whose use cases boards' routes for workspaces, members and
 * invitations call: auth keeps all three, and boards' UI manages them through boards'
 * own origin. A route of boards calls them as any client would: what they
 * write is auth's, and auth's own rules guard it. A use case of boards only reads
 * them, to put together what its screens show. Its tenants' events set boards' own
 * workspace going, and clear it away.
 */
export type WorkspaceAuth = {
  tenant: Tenant_Module
  access: Access_Module
  invitation: Invitation_Module
  user: User_Module
}

export interface Workspace_Deps {
  board: Board_Module
  column: Column_Module
  card: Card_Module
  member: Member_Module
  auth: WorkspaceAuth
}
