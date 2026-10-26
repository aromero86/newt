import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, assigned to nobody now, who had it, and who took it from them: nobody when a member left the workspace. */
type CardUnassignment = { dto: CardDTO, previousAssigneeId: string } & CardAuthor

export class Card_Unassigned implements DomainEvent<CardUnassignment> {
  static readonly eventName = 'card.unassigned'
  readonly name = Card_Unassigned.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardUnassignment) {}
}
