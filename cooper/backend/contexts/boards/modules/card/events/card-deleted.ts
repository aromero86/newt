import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card as it was when it was deleted, and who deleted it. */
type CardDeletion = CardDTO & CardAuthor

export class Card_Deleted implements DomainEvent<CardDeletion & CardEventStamp> {
  static readonly eventName = 'card.deleted'
  readonly name = Card_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardDeletion & CardEventStamp
  constructor(deletion: CardDeletion) {
    this.payload = { ...deletion, ...cardEventStamp() }
  }
}
