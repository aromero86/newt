import { ConflictError } from '../../../core/errors/conflict-error'

export class DeltasUnpublished extends ConflictError {
  readonly code = 'delta.unpublished'
  constructor() {
    super('The working copy has changes no revision published: publish them or discard them first')
  }
}
