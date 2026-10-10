import { EntityError } from './entity-error'

export class DeletedEntityNotChangeable extends EntityError {
  constructor() {
    super('Cannot change a deleted entity')
  }
}
