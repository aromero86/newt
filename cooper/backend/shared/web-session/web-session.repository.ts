import { TableRepository } from 'newt/repository'
import type { CooperBase } from '../cooper-base'
import { WebSession, type WebSessionDTO } from './web-session'

export type WebSessionRow = WebSessionDTO & { version: number }

/** The context's `session` table: each context has its own, made by the migration it copies. */
export class WebSession_Repository extends TableRepository<WebSession, WebSessionRow, CooperBase> {

  constructor(base: CooperBase) {
    super(base, base.store.table<WebSessionRow>('session'))
  }

  protected toEntity(row: WebSessionRow): WebSession {
    return WebSession.fromDTO(row)
  }
}
