import { TableRepository } from 'newt-kit/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { Retention, type RetentionRowDTO } from './retention'

export type RetentionRow = RetentionRowDTO & { version: number }

export class Retention_Repository extends TableRepository<Retention, RetentionRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one, by its id.
    super(base, base.store.table<RetentionRow>('retention'), { scope: 'none' })
  }

  protected toEntity(row: RetentionRow): Retention {
    return Retention.fromDTO(row)
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
