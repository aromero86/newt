import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalExtracting extends ConflictError {
  readonly code = 'proposal.extracting'
  constructor(revision: number, what: string) {
    super(`The deltas of revision ${revision} are still being extracted from its document: wait until they are ready to ${what}`)
  }
}
