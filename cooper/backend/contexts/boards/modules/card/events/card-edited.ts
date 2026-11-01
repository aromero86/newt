import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card as it is now, its title or description as they are (`changes`) and as they were (`previous`), and who edited it. */
type CardEdit = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Edited implements DomainEvent<CardEdit> {
  static readonly eventName = 'card.edited'
  readonly name = Card_Edited.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardEdit) {}
}
