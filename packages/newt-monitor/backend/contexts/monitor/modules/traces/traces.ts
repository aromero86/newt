import { Entity, type EntityInput } from 'newt-kit/core'
import { TracesFeedSchema, type TracesFeedDTO } from './traces.schema'

export * from './traces.schema'
export { TraceNotFound } from './errors/trace-not-found'

/** What the monitor has collected of one application's traces: its cursor. */
export class TracesFeed extends Entity<typeof TracesFeedSchema> {

  private constructor(input: EntityInput<TracesFeedDTO>, isNew: boolean) {
    super(TracesFeedSchema, input, isNew)
  }

  static fromDTO(dto: TracesFeedDTO & { version: number }): TracesFeed {
    return new TracesFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): TracesFeed {
    return new TracesFeed({ appId, until: null }, true)
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
