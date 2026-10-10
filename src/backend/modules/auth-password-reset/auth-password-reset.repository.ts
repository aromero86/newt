import { and, eq, isNull } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { authPasswordReset } from './infrastructure/auth-password-reset.table'
import { AuthPasswordReset } from './auth-password-reset'

export interface AuthPasswordReset_Criteria {
  tokenHash?: string
  userId?: string
  /** Neither used nor cancelled (it may still have expired). */
  pending?: boolean
}

export class AuthPasswordReset_Repository extends Repository<Base> {

  async find(criteria: AuthPasswordReset_Criteria): Promise<AuthPasswordReset[]> {
    const conditions = []
    if (criteria.tokenHash !== undefined) conditions.push(eq(authPasswordReset.tokenHash, criteria.tokenHash))
    if (criteria.userId !== undefined) conditions.push(eq(authPasswordReset.userId, criteria.userId))
    if (criteria.pending) conditions.push(isNull(authPasswordReset.usedAt), isNull(authPasswordReset.cancelledAt))

    const rows = await this.db.select().from(authPasswordReset).where(and(...conditions))
    return rows.map(row => AuthPasswordReset.fromDTO(row))
  }

  async persist(entity: AuthPasswordReset): Promise<AuthPasswordReset> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(authPasswordReset).values(dto)
    } else {
      await this.db
        .update(authPasswordReset)
        .set({ usedAt: dto.usedAt, cancelledAt: dto.cancelledAt, updatedAt: dto.updatedAt })
        .where(eq(authPasswordReset.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }
}
