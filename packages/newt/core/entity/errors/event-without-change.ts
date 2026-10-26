import { EntityError } from './entity-error'

/**
 * An entity that tells something happened but never changed: an event comes with the
 * change it tells, which its save writes, so one with nothing to write would tell
 * what no row shows.
 */
export class EventWithoutChange extends EntityError {
  constructor(entity: string, id: string, events: string[]) {
    super(`${entity} ${id} tells ${events.join(', ')} but has nothing to save: change what it tells of (a field that says it happened, a status or a date) along with it, or do not track it`)
  }
}
