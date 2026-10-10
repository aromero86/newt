import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { Dimension } from './dimension'
import { dimension, dimensionValue } from './infrastructure/dimension.table'

export interface Dimension_Criteria {
  workspaceId?: string
  id?: string[]
}

export class Dimension_Repository extends Repository<Base> {

  /** In order, each with its values in order. */
  async find(criteria: Dimension_Criteria): Promise<Dimension[]> {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(dimension.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(dimension.id, criteria.id))

    const rows = await this.db.select().from(dimension).where(and(...conditions)).orderBy(asc(dimension.position))
    if (rows.length === 0) return []
    const values = await this.db
      .select()
      .from(dimensionValue)
      .where(inArray(dimensionValue.dimensionId, rows.map(row => row.id)))
      .orderBy(asc(dimensionValue.position))

    return rows.map(row => Dimension.fromDTO({
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      position: row.position,
      values: values.filter(value => value.dimensionId === row.id).map(value => ({ id: value.id, name: value.name, retiredAt: value.retiredAt })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async count(workspaceId: string): Promise<number> {
    return (await this.db.select({ id: dimension.id }).from(dimension).where(eq(dimension.workspaceId, workspaceId))).length
  }

  async persist(entity: Dimension): Promise<Dimension> {
    const dto = entity.toDTO()
    const row = { name: dto.name, position: dto.position, updatedAt: dto.updatedAt }

    if (entity.isNew) {
      await this.db.insert(dimension).values({ id: dto.id, workspaceId: dto.workspaceId, ...row, createdAt: dto.createdAt })
    } else {
      await this.db.update(dimension).set(row).where(eq(dimension.id, dto.id))
    }
    if (entity.hasChanged('values')) await this.syncValues(dto.id, dto.values)

    entity.dispatchEvents(this.publisher)
    return entity
  }

  /** The child table follows the aggregate: new values are added, the rest updated in place. */
  private async syncValues(dimensionId: string, values: { id: string, name: string, retiredAt: string | null }[]): Promise<void> {
    const now = new Date().toISOString()
    const stored = new Set(
      (await this.db.select({ id: dimensionValue.id }).from(dimensionValue).where(eq(dimensionValue.dimensionId, dimensionId))).map(row => row.id),
    )
    for (const [position, value] of values.entries()) {
      if (stored.has(value.id)) {
        await this.db
          .update(dimensionValue)
          .set({ name: value.name, position, retiredAt: value.retiredAt, updatedAt: now })
          .where(eq(dimensionValue.id, value.id))
      } else {
        await this.db.insert(dimensionValue).values({ id: value.id, dimensionId, name: value.name, position, retiredAt: value.retiredAt, createdAt: now, updatedAt: now })
      }
    }
  }
}
