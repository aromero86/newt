import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalUnpublished extends ConflictError {
  readonly code = 'proposal.unpublished'
  constructor() {
    super('The working copy has changes no revision published: publish them or discard them first')
  }
}
