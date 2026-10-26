import { EntityError } from './entity-error'

/**
 * An entity saved again after a save it was in rolled back: what it holds may no
 * longer be what is stored, nor what it tells what it would write.
 */
export class SaveRolledBack extends EntityError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was in a save that rolled back: read it again, and save that one`)
  }
}
