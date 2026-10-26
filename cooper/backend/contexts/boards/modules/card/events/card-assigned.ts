import { now, type DomainEvent } from 'newt/core'
import type { CardAuthor, CardDTO } from '../card.schema'

/** The card, now assigned to `dto.assigneeId`, who had it before, if anyone, and who assigned it. */
type CardAssignment = { dto: CardDTO, previousAssigneeId: string | null } & CardAuthor & { by: string }

export class Card_Assigned implements DomainEvent<CardAssignment> {
  static readonly eventName = 'card.assigned'
  readonly name = Card_Assigned.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: CardAssignment) {}
}
