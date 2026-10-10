import { eq } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { Credential } from './credential'
import { credential } from './infrastructure/credential.table'

export class Credential_Repository extends Repository<Base> {

  async findOf(userId: string): Promise<Credential | null> {
    const [row] = await this.db.select().from(credential).where(eq(credential.userId, userId))
    return row ? Credential.fromDTO(row) : null
  }

  async persist(entity: Credential): Promise<Credential> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(credential).values(dto)
    } else {
      await this.db.update(credential).set({ passwordHash: dto.passwordHash, updatedAt: dto.updatedAt }).where(eq(credential.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }
}
