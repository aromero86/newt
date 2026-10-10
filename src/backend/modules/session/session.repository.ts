import { and, eq, inArray, ne } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { session } from './infrastructure/session.table'
import { Session } from './session'

export interface Session_Criteria {
  id?: string[]
  tokenHash?: string
  userId?: string
  /** Every session but this one. */
  exceptId?: string
}

export class Session_Repository extends Repository<Base> {

  async find(criteria: Session_Criteria): Promise<Session[]> {
    const rows = await this.db.select().from(session).where(and(...this.conditions(criteria)))
    return rows.map(row => Session.fromDTO(row))
  }

  async persist(entity: Session): Promise<Session> {
    await this.db.insert(session).values(entity.toDTO())
    return entity
  }

  /** Ending a session removes it: sessions are not history. */
  async delete(criteria: Session_Criteria): Promise<void> {
    await this.db.delete(session).where(and(...this.conditions(criteria)))
  }

  private conditions(criteria: Session_Criteria) {
    const conditions = []
    if (criteria.id) conditions.push(inArray(session.id, criteria.id))
    if (criteria.tokenHash !== undefined) conditions.push(eq(session.tokenHash, criteria.tokenHash))
    if (criteria.userId !== undefined) conditions.push(eq(session.userId, criteria.userId))
    if (criteria.exceptId !== undefined) conditions.push(ne(session.id, criteria.exceptId))
    // Criteria with no conditions must never match every session.
    if (conditions.length === 0) throw new Error('Session criteria cannot be empty')
    return conditions
  }
}
