import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/**
 * The card someone moved: its column and position now (`changes`) and before
 * (`previous`), and who moved it: nobody when its column was removed. The cards it
 * pushed aside tell nothing: they only took the places left.
 */
type CardMove = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Moved implements DomainEvent<CardMove & CardEventStamp> {
  static readonly eventName = 'card.moved'
  readonly name = Card_Moved.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardMove & CardEventStamp
  constructor(move: CardMove) {
    this.payload = { ...move, ...cardEventStamp() }
  }
}
