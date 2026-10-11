import { ConflictError } from '../../../core/errors/conflict-error'

export class NothingToPublish extends ConflictError {
  readonly code = 'proposal.nothing_to_publish'
  constructor() {
    super('The working copy says the same as the last revision: there is nothing to publish')
  }
}
