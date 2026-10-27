import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { MetricsFeed, type MetricsFeedDTO } from './metrics'

export type MetricsFeedRow = MetricsFeedDTO & { version: number }

export class MetricsFeed_Repository extends TableRepository<MetricsFeed, MetricsFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<MetricsFeedRow>('metrics_feed'), { scope: 'none' })
  }

  protected toEntity(row: MetricsFeedRow): MetricsFeed {
    return MetricsFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
