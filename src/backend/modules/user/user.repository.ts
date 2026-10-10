import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { user } from './infrastructure/user.table'
import { User } from './user'

export interface User_Criteria {
  id?: string[]
  /** Any case. */
  nick?: string
  /** Any case. */
  email?: string
  /** A nick or an email, as typed at sign-in. */
  login?: string
}

export class User_Repository extends Repository<Base> {

  async find(criteria: User_Criteria): Promise<User[]> {
    const rows = await this.db.select().from(user).where(and(...this.conditions(criteria))).orderBy(user.nick)
    return rows.map(row => User.fromDTO({
      id: row.id,
      nick: row.nick,
      fullName: row.fullName,
      email: row.email,
      bio: row.bio,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async persist(entity: User): Promise<User> {
    const dto = entity.toDTO()
    const values = { nick: dto.nick, fullName: dto.fullName, email: dto.email, bio: dto.bio, updatedAt: dto.updatedAt }

    if (entity.isNew) {
      await this.db.insert(user).values({ id: dto.id, ...values, createdAt: dto.createdAt })
    } else {
      await this.db.update(user).set(values).where(eq(user.id, dto.id))
    }

    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: User_Criteria) {
    const lower = (value: string) => value.trim().toLowerCase()
    const conditions = [isNull(user.deletedAt)]
    if (criteria.id) conditions.push(inArray(user.id, criteria.id))
    if (criteria.nick !== undefined) conditions.push(eq(sql`lower(${user.nick})`, lower(criteria.nick)))
    if (criteria.email !== undefined) conditions.push(eq(sql`lower(${user.email})`, lower(criteria.email)))
    if (criteria.login !== undefined) {
      conditions.push(or(eq(sql`lower(${user.nick})`, lower(criteria.login)), eq(sql`lower(${user.email})`, lower(criteria.login)))!)
    }
    return conditions
  }
}
