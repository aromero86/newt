import type { DomainEvent } from 'newt/core'
import type { CardDTO } from '../card.schema'

/** The new card, with its number and its place. */
export class Card_Created implements DomainEvent<CardDTO> {
  static readonly eventName = 'card.created'
  readonly name = Card_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: CardDTO) {}
}
