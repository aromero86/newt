import type { Tenant_Module } from '../../../auth/modules/tenant/tenant.module'
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

export interface Attachment_Deps {
  /** That a card is there, in the current workspace; and a card going, whose files go with it. */
  card: Card_Module
  /** Who may enter the workspace its routes are under. */
  member: Member_Module
  /** auth deleting a workspace: its files go with it. */
  auth: {
    tenant: Tenant_Module
  }
}
