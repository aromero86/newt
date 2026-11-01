import { TableRepository } from 'newt-kit/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { assertAppThere, unlessAppGone } from '../../../../shared/app-gone'
import { Connection, type ConnectionDTO } from './connection'

export type ConnectionRow = ConnectionDTO & { version: number }

export class Connection_Repository extends TableRepository<Connection, ConnectionRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants. An application has one row, by its id.
    super(base, base.store.table<ConnectionRow>('connection', { types: { identity: 'json', failure: 'json' } }), { scope: 'none' })
  }

  protected toEntity(row: ConnectionRow): Connection {
    return Connection.fromDTO(row)
  }

  /**
   * Saves a call's note unless its application was deleted while it was being called:
   * checked in the save, as forgetting it may have run meanwhile. Whether it saved.
   */
  persistWhileThere(appId: string, connection: Connection, isThere: () => Promise<boolean>): Promise<boolean> {
    return unlessAppGone(() => this.save([connection], each => this.write(each), {
      guard: [`connection:${appId}`],
      after: () => assertAppThere(isThere),
    }))
  }

  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
}
