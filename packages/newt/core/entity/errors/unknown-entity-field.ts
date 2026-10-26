import { EntityError } from './entity-error'

export class UnknownEntityField extends EntityError {
  constructor(field: string) {
    super(`Unknown field '${field}' for this entity`)
  }
}
