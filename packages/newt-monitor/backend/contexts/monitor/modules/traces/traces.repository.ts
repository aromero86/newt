import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { TracesFeed, type TracesFeedDTO } from './traces'

export type TracesFeedRow = TracesFeedDTO & { version: number }

export class TracesFeed_Repository extends TableRepository<TracesFeed, TracesFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<TracesFeedRow>('traces_feed'), { scope: 'none' })
  }

  protected toEntity(row: TracesFeedRow): TracesFeed {
    return TracesFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
