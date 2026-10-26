import type { DomainEventEmitter } from 'newt/core'
import type { Board_Module } from '../board/board.module'
import type { Card_Module } from '../card/card.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * auth's events about workspaces (its tenants) that boards reacts to, as a port: what
 * boards needs of them, in its own words. auth's emitters fit it; a test hands its own.
 */
export type TenantEvents = {
  created: Pick<DomainEventEmitter<{ id: string }>, 'subscribe'>
  deleted: Pick<DomainEventEmitter<{ id: string }>, 'subscribe'>
}

export interface Workspace_Deps {
  board: Board_Module
  column: Column_Module
  card: Card_Module
  member: Member_Module
  tenants: TenantEvents
}
