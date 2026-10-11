import { ConflictError } from '../../../core/errors/conflict-error'

export class ProposalDocumentChanged extends ConflictError {
  readonly code = 'proposal.document_changed'
  constructor() {
    super('The document changed while its deltas were being extracted: nothing was published. Publish again')
  }
}
