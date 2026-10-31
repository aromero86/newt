import { EntityError } from './entity-error'

/** A field an entity cannot change: its schema lacks it, or, with `reason`, the framework keeps it. */
export class UnknownEntityField extends EntityError {
  constructor(field: string, reason?: string) {
    super(reason ? `Field '${field}' cannot be changed: ${reason}` : `Unknown field '${field}' for this entity`)
  }
}
