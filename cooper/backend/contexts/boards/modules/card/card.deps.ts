import type { EventSource } from 'newt/core'
import type { Board_Module } from '../board/board.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * Someone's access to a product of auth's: to a workspace of `cooper` (`tenantId`),
 * or to a product with none (null, the backoffice's staff).
 */
export type RevokedAccess = { userId: string, productId: string, tenantId: string | null }

/**
 * auth's events the cards react to, as a port: what boards needs of them, in its own
 * words. auth's emitters fit it; a test hands its own.
 */
export type AccessEvents = {
  /** Someone lost their access to a product of auth's. */
  revoked: EventSource<RevokedAccess>
}

export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  access: AccessEvents
}
