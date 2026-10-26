import { EntityError } from './entity-error'

export class NewEntityNotDeletable extends EntityError {
  constructor() {
    super('Cannot delete an entity that was never persisted')
  }
}
