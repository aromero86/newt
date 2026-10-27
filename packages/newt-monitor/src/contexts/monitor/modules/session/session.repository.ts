import { TableRepository } from 'newt/repository'
import type { MonitorBase } from '../../../../monitor-base'
import { Session, type SessionDTO } from './session'

export type SessionRow = SessionDTO & { version: number }

export class Session_Repository extends TableRepository<Session, SessionRow, MonitorBase> {

  constructor(base: MonitorBase) {
    // No scope: the monitor has no tenants, and a session is found by its token.
    super(base, base.store.table<SessionRow>('session'), { scope: 'none' })
  }

  protected toEntity(row: SessionRow): Session {
    return Session.fromDTO(row)
  }
}
