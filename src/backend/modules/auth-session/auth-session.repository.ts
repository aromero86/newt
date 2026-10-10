import { and, eq, inArray, ne } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { authSession } from './infrastructure/auth-session.table'
import { AuthSession } from './auth-session'

export interface AuthSession_Criteria {
  id?: string[]
  tokenHash?: string
  userId?: string
  /** Every authSession but this one. */
  exceptId?: string
}

export class AuthSession_Repository extends Repository<Base> {

  async find(criteria: AuthSession_Criteria): Promise<AuthSession[]> {
    const rows = await this.db.select().from(authSession).where(and(...this.conditions(criteria)))
    return rows.map(row => AuthSession.fromDTO(row))
  }

  async persist(entity: AuthSession): Promise<AuthSession> {
    await this.db.insert(authSession).values(entity.toDTO())
    return entity
  }

  /** Ending a authSession removes it: sessions are not history. */
  async delete(criteria: AuthSession_Criteria): Promise<void> {
    await this.db.delete(authSession).where(and(...this.conditions(criteria)))
  }

  private conditions(criteria: AuthSession_Criteria) {
    const conditions = []
    if (criteria.id) conditions.push(inArray(authSession.id, criteria.id))
    if (criteria.tokenHash !== undefined) conditions.push(eq(authSession.tokenHash, criteria.tokenHash))
    if (criteria.userId !== undefined) conditions.push(eq(authSession.userId, criteria.userId))
    if (criteria.exceptId !== undefined) conditions.push(ne(authSession.id, criteria.exceptId))
    // Criteria with no conditions must never match every authSession.
    if (conditions.length === 0) throw new Error('AuthSession criteria cannot be empty')
    return conditions
  }
}
