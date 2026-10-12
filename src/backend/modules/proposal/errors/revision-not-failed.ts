import { ConflictError } from '../../../core/errors/conflict-error'

export class RevisionNotFailed extends ConflictError {
  readonly code = 'proposal.revision_not_failed'
  constructor() {
    super('Only the last revision, when the extraction of its deltas failed, is extracted again')
  }
}
