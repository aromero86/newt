import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalExtractionFailed extends ConflictError {
  readonly code = 'proposal.extraction_failed'
  constructor(revision: number, what: string) {
    super(`The deltas of revision ${revision} could not be extracted from its document: retry it, or publish a new revision, to ${what}`)
  }
}
