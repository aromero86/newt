import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalNotInReview extends ConflictError {
  readonly code = 'proposal.not_in_review'
  constructor() {
    super('Deltas are approved or rejected while the proposal is in review')
  }
}
