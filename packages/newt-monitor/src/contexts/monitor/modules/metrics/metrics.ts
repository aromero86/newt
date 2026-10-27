import { Entity, type EntityInput } from 'newt/core'
import { MetricsFeedSchema, type MetricsFeedDTO, type MetricsRetentionDTO } from './metrics.schema'

export * from './metrics.schema'

/** What the monitor collects of one application's metrics: its cursor, and how long it keeps them. */
export class MetricsFeed extends Entity<typeof MetricsFeedSchema> {

  private constructor(input: EntityInput<MetricsFeedDTO>, isNew: boolean) {
    super(MetricsFeedSchema, input, isNew)
  }

  static fromDTO(dto: MetricsFeedDTO & { version: number }): MetricsFeed {
    return new MetricsFeed(dto, false)
  }

  /** Before its first collection, with the retention by default. */
  static start(appId: string): MetricsFeed {
    return new MetricsFeed({ appId, until: null, minuteDays: 30, dayDays: null }, true)
  }

  get appId(): string {
    return this.data.appId
  }

  get until(): string | null {
    return this.data.until
  }

  get retention(): MetricsRetentionDTO {
    return { minuteDays: this.data.minuteDays, dayDays: this.data.dayDays }
  }

  /** Collected up to a minute: the next collection asks from it. */
  collectedUntil(until: string): void {
    if (this.data.until === null || until > this.data.until) this.change({ until })
  }

  keep(retention: Partial<MetricsRetentionDTO>): void {
    this.change(retention)
  }
}
