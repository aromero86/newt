import { NotFoundError } from '../../../core/errors/not-found-error'

export class ProposalNotFound extends NotFoundError {
  readonly code = 'proposal.not_found'
  constructor(key: string) {
    super(`Proposal ${key} not found`)
  }
}
