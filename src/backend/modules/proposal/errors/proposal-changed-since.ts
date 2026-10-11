import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalChangedSince extends ConflictError {
  readonly code = 'proposal.changed_since'
  constructor(basedOn: number, revision: number) {
    super(`It was based on revision ${basedOn}, but revision ${revision} is the last one now: read it again and iterate on that`)
  }
}
