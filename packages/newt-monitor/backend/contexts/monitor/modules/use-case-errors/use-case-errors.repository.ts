import { TableRepository } from '@newt-kit/newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { UseCaseErrorsFeed, type UseCaseErrorsFeedDTO } from './use-case-errors'

export type UseCaseErrorsFeedRow = UseCaseErrorsFeedDTO & { version: number }

export class UseCaseErrorsFeed_Repository extends TableRepository<UseCaseErrorsFeed, UseCaseErrorsFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<UseCaseErrorsFeedRow>('use_case_errors_feed'), { scope: 'none' })
  }

  protected toEntity(row: UseCaseErrorsFeedRow): UseCaseErrorsFeed {
    return UseCaseErrorsFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
