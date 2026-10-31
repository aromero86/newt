import { TableRepository } from 'newt/repository'
import type { CooperBase } from '../cooper-base'
import { WebSession, type WebSessionDTO } from './web-session'

export type WebSessionRow = WebSessionDTO & { version: number }

/** The context's `session` table: each context has its own, made by the migration it copies. */
export class WebSession_Repository extends TableRepository<WebSession, WebSessionRow, CooperBase> {

  constructor(base: CooperBase) {
    // No scope: a session is a person's, found by its token, in no workspace.
    super(base, base.store.table<WebSessionRow>('session'), { scope: 'none' })
  }

  protected toEntity(row: WebSessionRow): WebSession {
    return WebSession.fromDTO(row)
  }

  /** Removes for good the sessions expired by `at`, closed by nobody: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ expiresAt: { lte: at.toISOString() } })
  }
}
