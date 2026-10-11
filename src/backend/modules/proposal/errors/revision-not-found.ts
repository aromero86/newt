import { NotFoundError } from '../../../core/errors/not-found-error'

export class RevisionNotFound extends NotFoundError {
  readonly code = 'proposal.revision_not_found'
  constructor(number: number) {
    super(`Revision ${number} not found`)
  }
}
