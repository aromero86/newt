import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { workspace } from './infrastructure/workspace.table'
import { Workspace } from './workspace'

export interface Workspace_Criteria {
  id?: string[]
  createdBy?: string
  /** Any case. */
  name?: string
}

export class Workspace_Repository extends Repository<Base> {

  async find(criteria: Workspace_Criteria): Promise<Workspace[]> {
    const conditions = []
    if (criteria.id) conditions.push(inArray(workspace.id, criteria.id))
    if (criteria.createdBy !== undefined) conditions.push(eq(workspace.createdBy, criteria.createdBy))
    if (criteria.name !== undefined) conditions.push(eq(sql`lower(${workspace.name})`, criteria.name.trim().toLowerCase()))

    const rows = await this.db.select().from(workspace).where(and(...conditions)).orderBy(workspace.name)
    return rows.map(row => Workspace.fromDTO(row))
  }

  async persist(entity: Workspace): Promise<Workspace> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(workspace).values(dto)
    } else {
      await this.db
        .update(workspace)
        .set({ name: dto.name, description: dto.description, archivedAt: dto.archivedAt, updatedAt: dto.updatedAt })
        .where(eq(workspace.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }
}
