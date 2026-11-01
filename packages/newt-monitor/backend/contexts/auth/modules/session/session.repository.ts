import { TableRepository } from '@newt-kit/newt/repository'
import type { AuthBase } from '../../auth-base'
import { Session, type SessionDTO } from './session'

export type SessionRow = SessionDTO & { version: number }

/** What the sessions were opened with: one row, its id `current`. */
export type SessionCredentialsRow = { id: string, fingerprint: string, version: number }

const CURRENT = 'current'

export class Session_Repository extends TableRepository<Session, SessionRow, AuthBase> {

  private readonly credentials

  constructor(base: AuthBase) {
    // No scope: the monitor has no tenants, and a session is found by its token.
    super(base, base.store.table<SessionRow>('session'), { scope: 'none' })
    this.credentials = base.store.table<SessionCredentialsRow>('session_credentials')
  }

  protected toEntity(row: SessionRow): Session {
    return Session.fromDTO(row)
  }

  /** Removes for good the sessions expired by `at`, closed by nobody: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ expiresAt: { lte: at.toISOString() } })
  }

  /** What the sessions were opened with: undefined before any were. */
  async openedWith(): Promise<string | undefined> {
    const [row] = await this.credentials.find({ id: CURRENT })
    return row?.fingerprint
  }

  /** Keeps what the sessions are opened with, from now on. */
  async openWith(fingerprint: string): Promise<void> {
    await this.saveRows(() => this.replaceCredentials(fingerprint))
  }

  /** Removes every session, and keeps what the next ones are opened with: how many it removed. */
  async endAll(fingerprint: string): Promise<number> {
    let removed = 0
    await this.saveRows(async () => {
      removed = await this.table.deleteMany({})
      await this.replaceCredentials(fingerprint)
    })
    return removed
  }

  /** Replaced, not read and changed: a save reads nothing it does not guard. */
  private async replaceCredentials(fingerprint: string): Promise<void> {
    await this.credentials.deleteMany({})
    await this.credentials.insert({ id: CURRENT, fingerprint })
  }
}
