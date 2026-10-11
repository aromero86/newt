import { and, count, desc, eq, inArray, lt } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { AuthToken } from './auth-token'
import { authToken } from './infrastructure/auth-token.table'

export interface AuthToken_Criteria {
  id?: string[]
  userId?: string
  tokenHash?: string
}

export class AuthToken_Repository extends Repository<Base> {

  async find(criteria: AuthToken_Criteria): Promise<AuthToken[]> {
    const rows = await this.db.select().from(authToken).where(and(...this.conditions(criteria)))
    return rows.map(row => AuthToken.fromDTO(row))
  }

  /** A page of a person's tokens, newest first. The cursor is a token id. */
  async page(userId: string, page: PageRequest): Promise<Page<AuthToken>> {
    const conditions = this.conditions({ userId })
    const rows = await this.db
      .select()
      .from(authToken)
      .where(and(...conditions, ...(page.cursor ? [lt(authToken.id, page.cursor)] : [])))
      .orderBy(desc(authToken.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(authToken).where(and(...conditions))
    return toPage(rows.map(row => AuthToken.fromDTO(row)), page.size, total?.total ?? 0)
  }

  async persist(entity: AuthToken): Promise<AuthToken> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(authToken).values(dto)
    } else {
      await this.db.update(authToken).set({ lastUsedAt: dto.lastUsedAt, updatedAt: dto.updatedAt }).where(eq(authToken.id, dto.id))
    }
    return entity
  }

  /** Revoking a token removes it: like sessions, tokens are not history. */
  async delete(criteria: AuthToken_Criteria): Promise<void> {
    await this.db.delete(authToken).where(and(...this.conditions(criteria)))
  }

  private conditions(criteria: AuthToken_Criteria) {
    const conditions = []
    if (criteria.id) conditions.push(inArray(authToken.id, criteria.id))
    if (criteria.userId !== undefined) conditions.push(eq(authToken.userId, criteria.userId))
    if (criteria.tokenHash !== undefined) conditions.push(eq(authToken.tokenHash, criteria.tokenHash))
    // Criteria with no conditions must never match every token.
    if (conditions.length === 0) throw new Error('AuthToken criteria cannot be empty')
    return conditions
  }
}
