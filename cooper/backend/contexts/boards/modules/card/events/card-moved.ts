import { now, type DomainEvent } from 'newt-kit/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/**
 * The card someone moved: its column and position now (`changes`) and before
 * (`previous`), and who moved it: nobody when its column was removed. The cards it
 * pushed aside tell nothing: they only took the places left.
 */
type CardMove = { dto: CardDTO, changes: Partial<CardDTO>, previous: Partial<CardDTO> } & CardAuthor

export class Card_Moved implements DomainEvent<CardMove> {
  static readonly eventName = 'card.moved'
  readonly name = Card_Moved.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardMove) {}
}
