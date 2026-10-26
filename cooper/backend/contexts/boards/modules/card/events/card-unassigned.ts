import type { DomainEvent } from 'newt/core'
import type { CardDTO } from '../card.schema'

/** The card, assigned to nobody now, and who had it. */
type CardUnassignment = { dto: CardDTO, previousAssigneeId: string }

export class Card_Unassigned implements DomainEvent<CardUnassignment> {
  static readonly eventName = 'card.unassigned'
  readonly name = Card_Unassigned.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardUnassignment) {}
}
