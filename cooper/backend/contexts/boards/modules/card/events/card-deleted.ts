import type { DomainEvent } from 'newt/core'
import type { CardDTO } from '../card.schema'

/** The card as it was when it was deleted. */
export class Card_Deleted implements DomainEvent<CardDTO> {
  static readonly eventName = 'card.deleted'
  readonly name = Card_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardDTO) {}
}
