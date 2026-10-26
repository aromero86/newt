import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment & CardEventStamp> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardAssignment & CardEventStamp
  constructor(assignment: CardAssignment) {
    this.payload = { ...assignment, ...cardEventStamp() }
  }
}
