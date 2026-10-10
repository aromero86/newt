import { and, asc, between, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { Feature } from './feature'
import { feature } from './infrastructure/feature.table'

export interface Feature_Criteria {
  workspaceId?: string
  areaId?: string
  id?: string[]
  name?: string
  retired?: boolean
  /** Positions from one to the other, both included. */
  positions?: { from: number, to: number }
}

export class Feature_Repository extends Repository<Base> {

  async find(criteria: Feature_Criteria): Promise<Feature[]> {
    const rows = await this.db.select().from(feature).where(and(...this.conditions(criteria))).orderBy(asc(feature.position), asc(feature.id))
    return rows.map(row => Feature.fromDTO(row))
  }

  /**
   * A page of an area's features. Active ones in their order: the cursor is the id
   * of the last feature shown, and the page goes on after its position. Retired
   * ones in the order they were created.
   */
  async page(areaId: string, retired: boolean, page: PageRequest): Promise<Page<Feature>> {
    const criteria = { areaId, retired }
    const after = page.cursor ? await this.after(page.cursor, retired) : []
    const rows = await this.db
      .select()
      .from(feature)
      .where(and(...this.conditions(criteria), ...after))
      .orderBy(retired ? asc(feature.id) : asc(feature.position))
      .limit(page.size + 1)
    return toPage(rows.map(row => Feature.fromDTO(row)), page.size, await this.count(criteria))
  }

  async count(criteria: Feature_Criteria): Promise<number> {
    const [result] = await this.db.select({ total: count() }).from(feature).where(and(...this.conditions(criteria)))
    return result?.total ?? 0
  }


  async persist(entity: Feature): Promise<Feature> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(feature).values(dto)
    } else {
      const { id, workspaceId: _, createdAt: __, ...row } = dto
      await this.db.update(feature).set(row).where(eq(feature.id, id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private async after(cursor: string, retired: boolean) {
    if (retired) return [gt(feature.id, cursor)]
    const [last] = await this.db.select({ position: feature.position }).from(feature).where(eq(feature.id, cursor))
    return [gt(feature.position, last?.position ?? -1)]
  }

  private conditions(criteria: Feature_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(feature.workspaceId, criteria.workspaceId))
    if (criteria.areaId !== undefined) conditions.push(eq(feature.areaId, criteria.areaId))
    if (criteria.id) conditions.push(inArray(feature.id, criteria.id))
    if (criteria.name !== undefined) conditions.push(sql`lower(${feature.name}) = lower(${criteria.name.trim()})`)
    if (criteria.positions) conditions.push(between(feature.position, criteria.positions.from, criteria.positions.to))
    if (criteria.retired !== undefined) conditions.push(criteria.retired ? isNotNull(feature.retiredAt) : isNull(feature.retiredAt))
    return conditions
  }
}
