import type { DomainEvent } from '../../../core/events/domain-event'
import type { ProposalChangedPayload } from '../proposal.schema'

export class Proposal_Changed implements DomainEvent<ProposalChangedPayload> {
  static readonly eventName = 'proposal.changed'
  readonly name = Proposal_Changed.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: ProposalChangedPayload) {}
}
