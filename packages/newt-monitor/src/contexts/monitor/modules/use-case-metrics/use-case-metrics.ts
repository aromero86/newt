import { Entity, type EntityInput } from 'newt/core'
import { UseCaseMetricsFeedSchema, type UseCaseMetricsFeedDTO } from './use-case-metrics.schema'

export * from './use-case-metrics.schema'

/** What the monitor has collected of one application's use case timings: its cursor. */
export class UseCaseMetricsFeed extends Entity<typeof UseCaseMetricsFeedSchema> {

  private constructor(input: EntityInput<UseCaseMetricsFeedDTO>, isNew: boolean) {
    super(UseCaseMetricsFeedSchema, input, isNew)
  }

  static fromDTO(dto: UseCaseMetricsFeedDTO & { version: number }): UseCaseMetricsFeed {
    return new UseCaseMetricsFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): UseCaseMetricsFeed {
    return new UseCaseMetricsFeed({ appId, until: null }, true)
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
