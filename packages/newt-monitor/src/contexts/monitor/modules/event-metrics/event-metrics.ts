import { Entity, type EntityInput } from 'newt/core'
import { EventMetricsFeedSchema, type EventMetricsFeedDTO } from './event-metrics.schema'

export * from './event-metrics.schema'

/** What the monitor has collected of one application's events: its cursor. */
export class EventMetricsFeed extends Entity<typeof EventMetricsFeedSchema> {

  private constructor(input: EntityInput<EventMetricsFeedDTO>, isNew: boolean) {
    super(EventMetricsFeedSchema, input, isNew)
  }

  static fromDTO(dto: EventMetricsFeedDTO & { version: number }): EventMetricsFeed {
    return new EventMetricsFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): EventMetricsFeed {
    return new EventMetricsFeed({ appId, until: null }, true)
  }

  get appId(): string {
    return this.data.appId
  }

  get until(): string | null {
    return this.data.until
  }

  /** Collected up to a minute: the next collection asks from it. */
  collectedUntil(until: string): void {
    if (this.data.until === null || until > this.data.until) this.change({ until })
  }
}
