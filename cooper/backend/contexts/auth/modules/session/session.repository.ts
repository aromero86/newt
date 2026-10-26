import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Session, type SessionEntityDTO } from './session'

export type SessionRow = SessionEntityDTO & { version: number }

export class Session_Repository extends TableRepository<Session, SessionRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<SessionRow>('session'))
  }

  protected toEntity(row: SessionRow): Session {
    return Session.fromDTO(row)
  }
}
