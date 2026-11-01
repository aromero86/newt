import { Entity, type EntityInput } from '@newt-kit/newt/core'
import { DaysShorterThanMinutes } from './errors/days-shorter-than-minutes'
import { RetentionSchema, type RetentionDTO, type RetentionRowDTO } from './retention.schema'

export * from './retention.schema'

/** How long the monitor keeps one application's metrics. */
export class Retention extends Entity<typeof RetentionSchema> {

  private constructor(input: EntityInput<RetentionRowDTO>, isNew: boolean) {
    super(RetentionSchema, input, isNew)
  }

  static fromDTO(dto: RetentionRowDTO & { version: number }): Retention {
    return new Retention(dto, false)
  }

  /** The retention by default, until it is changed. */
  static byDefault(appId: string): Retention {
    return new Retention({ appId, minuteDays: 30, dayDays: null, traceDays: 7, resourceMinuteDays: 30 }, true)
  }

  get days(): RetentionDTO {
    return { minuteDays: this.data.minuteDays, dayDays: this.data.dayDays, traceDays: this.data.traceDays, resourceMinuteDays: this.data.resourceMinuteDays }
  }

  /** Changes how long they are kept: the days never for less time than the minutes, whichever of the two changes. */
  keep(change: Partial<RetentionDTO>): void {
    const dayDays = change.dayDays === undefined ? this.data.dayDays : change.dayDays
    const minuteDays = change.minuteDays ?? this.data.minuteDays
    if (dayDays !== null && dayDays < minuteDays) throw new DaysShorterThanMinutes(dayDays, minuteDays)
    this.change(change)
  }
}
