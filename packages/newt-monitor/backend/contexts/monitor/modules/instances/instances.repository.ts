import { TableRepository } from '@newt-kit/newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { Instance, InstancesFeed, type InstanceRowDTO, type InstancesFeedDTO } from './instances'

export type InstancesFeedRow = InstancesFeedDTO & { version: number }
export type InstanceRow = InstanceRowDTO & { version: number }

export class InstancesFeed_Repository extends TableRepository<InstancesFeed, InstancesFeedRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one feed, by its id.
    super(base, base.store.table<InstancesFeedRow>('instances_feed'), { scope: 'none' })
  }

  protected toEntity(row: InstancesFeedRow): InstancesFeed {
    return InstancesFeed.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}

export class Instance_Repository extends TableRepository<Instance, InstanceRow, MonitorBase> {

  constructor(base: MonitorBase) {
    super(base, base.store.table<InstanceRow>('instance', { types: { process: 'json', server: 'json' } }), { scope: 'none' })
  }

  protected toEntity(row: InstanceRow): Instance {
    return Instance.fromDTO(row)
  }

  /** Those of an application gone long enough, by id: forgotten, so its list keeps what is recent. */
  async purgeGone(appId: string, ids: string[]): Promise<void> {
    if (ids.length > 0) await this.purge({ appId, id: { in: ids } })
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
