import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Session, type SessionEntityDTO } from './session'

export type SessionRow = SessionEntityDTO & { version: number }

export class Session_Repository extends TableRepository<Session, SessionRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: a session is a person's, found by its token, in no tenant.
    super(base, base.store.table<SessionRow>('session'), { scope: 'none' })
  }

  protected toEntity(row: SessionRow): Session {
    return Session.fromDTO(row)
  }

  /** Removes for good the sessions expired by `at`, closed by nobody: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ expiresAt: { lte: at.toISOString() } })
  }
}
