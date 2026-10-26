import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card, assigned to nobody now, who had it, and who took it from them: nobody when a member left the workspace. */
type CardUnassignment = { dto: CardDTO, previousAssigneeId: string } & CardAuthor

export class Card_Unassigned implements DomainEvent<CardUnassignment & CardEventStamp> {
  static readonly eventName = 'card.unassigned'
  readonly name = Card_Unassigned.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardUnassignment & CardEventStamp
  constructor(unassignment: CardUnassignment) {
    this.payload = { ...unassignment, ...cardEventStamp() }
  }
}
