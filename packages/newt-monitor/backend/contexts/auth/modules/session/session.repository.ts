import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Session, type SessionDTO } from './session'

export type SessionRow = SessionDTO & { version: number }

export class Session_Repository extends TableRepository<Session, SessionRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: the monitor has no tenants, and a session is found by its token.
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
