import { eq } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { AuthCredential } from './auth-credential'
import { authCredential } from './infrastructure/auth-credential.table'

export class AuthCredential_Repository extends Repository<Base> {

  async findOf(userId: string): Promise<AuthCredential | null> {
    const [row] = await this.db.select().from(authCredential).where(eq(authCredential.userId, userId))
    return row ? AuthCredential.fromDTO(row) : null
  }

  async persist(entity: AuthCredential): Promise<AuthCredential> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(authCredential).values(dto)
    } else {
      await this.db.update(authCredential).set({ passwordHash: dto.passwordHash, updatedAt: dto.updatedAt }).where(eq(authCredential.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }
}
