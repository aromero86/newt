import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The new card, with its number and its place, and who created it: nobody for boards' own work (a welcome card). */
type CardCreation = CardDTO & CardAuthor

export class Card_Created implements DomainEvent<CardCreation> {
  static readonly eventName = 'card.created'
  readonly name = Card_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardCreation) {}
}
