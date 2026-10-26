import type { DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'
import { cardEventStamp, type CardEventStamp } from './card-event-stamp'

/** The card as it is now, its title or description as they are (`changes`) and as they were (`previous`), and who edited it. */
type CardEdit = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Edited implements DomainEvent<CardEdit & CardEventStamp> {
  static readonly eventName = 'card.edited'
  readonly name = Card_Edited.eventName
  readonly occurredAt = new Date().toISOString()
  readonly payload: CardEdit & CardEventStamp
  constructor(edit: CardEdit) {
    this.payload = { ...edit, ...cardEventStamp() }
  }
}
