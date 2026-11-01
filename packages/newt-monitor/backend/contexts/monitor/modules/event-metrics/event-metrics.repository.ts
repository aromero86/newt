import { TableRepository } from 'newt-kit/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { EventMetricsFeed, type EventMetricsFeedDTO } from './event-metrics'

export type EventMetricsFeedRow = EventMetricsFeedDTO & { version: number }

export class EventMetricsFeed_Repository extends TableRepository<EventMetricsFeed, EventMetricsFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<EventMetricsFeedRow>('event_metrics_feed'), { scope: 'none' })
  }

  protected toEntity(row: EventMetricsFeedRow): EventMetricsFeed {
    return EventMetricsFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
