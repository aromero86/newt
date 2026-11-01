import { Entity, type EntityInput } from 'newt-kit/core'
import { ActivitySchema, type ActivityDTO } from './activity.schema'

export * from './activity.schema'

/**
 * An entry of a card's activity. Recorded once and never changed: a log only grows,
 * so two entries written at once never collide. It tells nothing: it is
 * itself what a card's events told.
 */
export class Activity extends Entity<typeof ActivitySchema> {

  private constructor(input: EntityInput<ActivityDTO>, isNew: boolean) {
    super(ActivitySchema, input, isNew)
  }

  static fromDTO(dto: ActivityDTO & { version: number }): Activity {
    return new Activity(dto, false)
  }

  /** A new entry, by the id of the event it records. */
  static record(input: EntityInput<ActivityDTO> & { id: string }): Activity {
    return new Activity(input, true)
  }
}
