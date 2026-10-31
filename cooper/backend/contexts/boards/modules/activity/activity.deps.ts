import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes), and that a workspace is still there to record in. */
  member: Member_Module
  /** auth deleting a workspace: its log goes with it. */
  auth: {
    tenant: Tenant_Module
  }
}
