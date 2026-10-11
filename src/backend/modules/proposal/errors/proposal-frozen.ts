import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalFrozen extends ConflictError {
  readonly code = 'proposal.frozen'
  constructor(status: string, what: string) {
    super(status === 'accepted' ? `The proposal is accepted: move it back to review to ${what}` : `The proposal is ${status}: it can no longer ${what}`)
  }
}
