import { Entity, type EntityInput } from 'newt/core'
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
    return new Retention({ appId, minuteDays: 30, dayDays: null }, true)
  }

  get days(): RetentionDTO {
    return { minuteDays: this.data.minuteDays, dayDays: this.data.dayDays }
  }

  keep(change: Partial<RetentionDTO>): void {
    this.change(change)
  }
}
