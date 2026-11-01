import { TableRepository } from '@newt-kit/newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { QueueMetricsFeed, type QueueMetricsFeedDTO } from './queue-metrics'

export type QueueMetricsFeedRow = QueueMetricsFeedDTO & { version: number }

export class QueueMetricsFeed_Repository extends TableRepository<QueueMetricsFeed, QueueMetricsFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<QueueMetricsFeedRow>('queue_metrics_feed'), { scope: 'none' })
  }

  protected toEntity(row: QueueMetricsFeedRow): QueueMetricsFeed {
    return QueueMetricsFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
