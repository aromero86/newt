import type { DomainEvent } from '../../../core/events/domain-event'
import type { ProposalExtractionRequestedPayload } from '../proposal.schema'

export class Proposal_ExtractionRequested implements DomainEvent<ProposalExtractionRequestedPayload> {
  static readonly eventName = 'proposal.extractionRequested'
  readonly name = Proposal_ExtractionRequested.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: ProposalExtractionRequestedPayload) {}
}
