import type { DomainEvent } from 'newt/core'
import type { CardDTO } from '../card.schema'

/** The new card, with its number and its place, and who created it: null for boards' own work (a welcome card). */
type CardCreation = CardDTO & { by: string | null }

export class Card_Created implements DomainEvent<CardCreation> {
  static readonly eventName = 'card.created'
  readonly name = Card_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardCreation) {}
}
