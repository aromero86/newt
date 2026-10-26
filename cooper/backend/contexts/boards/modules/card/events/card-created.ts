import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The new card, with its number and its place, and who created it: nobody for boards' own work (a welcome card). */
type CardCreation = CardDTO & CardAuthor

export class Card_Created implements DomainEvent<CardCreation & CardEventStamp> {
  static readonly eventName = 'card.created'
  readonly name = Card_Created.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardCreation & CardEventStamp
  constructor(creation: CardCreation) {
    this.payload = { ...creation, ...cardEventStamp() }
  }
}
