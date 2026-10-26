import type { DomainEventEmitter } from 'newt/core'
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

/** auth's event about workspaces the activity reacts to, as a port: auth's emitter fits it. */
export type WorkspaceDeletions = {
  deleted: Pick<DomainEventEmitter<{ id: string }>, 'subscribe'>
}

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
  /** auth deleting a workspace: its log goes with it. */
  tenants: WorkspaceDeletions
}
