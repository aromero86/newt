import type { DomainEvent } from 'newt/core'
import type { CardDTO } from '../card.schema'

/** The card as it is now, its title or description as they are (`changes`) and as they were (`previous`). */
type CardEdit = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> }

export class Card_Edited implements DomainEvent<CardEdit> {
  static readonly eventName = 'card.edited'
  readonly name = Card_Edited.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardEdit) {}
}
