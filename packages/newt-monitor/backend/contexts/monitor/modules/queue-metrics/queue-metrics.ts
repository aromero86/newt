import { Entity, type EntityInput } from 'newt-kit/core'
import { QueueMetricsFeedSchema, type QueueMetricsFeedDTO } from './queue-metrics.schema'

export * from './queue-metrics.schema'

/** What the monitor has collected of one application's queue flows: its cursor. */
export class QueueMetricsFeed extends Entity<typeof QueueMetricsFeedSchema> {

  private constructor(input: EntityInput<QueueMetricsFeedDTO>, isNew: boolean) {
    super(QueueMetricsFeedSchema, input, isNew)
  }

  static fromDTO(dto: QueueMetricsFeedDTO & { version: number }): QueueMetricsFeed {
    return new QueueMetricsFeed(dto, false)
  }

  /** Before its first collection. */
  static start(appId: string): QueueMetricsFeed {
    return new QueueMetricsFeed({ appId, until: null }, true)
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
