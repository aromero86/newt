import { now, type DomainEvent } from 'newt-kit/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card as it was when it was deleted, and who deleted it. */
type CardDeletion = CardDTO & CardAuthor

export class Card_Deleted implements DomainEvent<CardDeletion> {
  static readonly eventName = 'card.deleted'
  readonly name = Card_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardDeletion) {}
}
