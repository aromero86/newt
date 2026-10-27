import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
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
}
