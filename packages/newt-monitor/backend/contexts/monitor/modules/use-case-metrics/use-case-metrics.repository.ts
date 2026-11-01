import { TableRepository } from '@newt-kit/newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { UseCaseMetricsFeed, type UseCaseMetricsFeedDTO } from './use-case-metrics'

export type UseCaseMetricsFeedRow = UseCaseMetricsFeedDTO & { version: number }

export class UseCaseMetricsFeed_Repository extends TableRepository<UseCaseMetricsFeed, UseCaseMetricsFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<UseCaseMetricsFeedRow>('use_case_metrics_feed'), { scope: 'none' })
  }

  protected toEntity(row: UseCaseMetricsFeedRow): UseCaseMetricsFeed {
    return UseCaseMetricsFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
