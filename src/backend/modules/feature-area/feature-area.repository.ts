import { and, asc, between, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { FeatureArea } from './feature-area'
import { featureArea } from './infrastructure/feature-area.table'

export interface FeatureArea_Criteria {
  workspaceId?: string
  id?: string[]
  name?: string
  retired?: boolean
  /** Positions from one to the other, both included. */
  positions?: { from: number, to: number }
}

export class FeatureArea_Repository extends Repository<Base> {

  async find(criteria: FeatureArea_Criteria): Promise<FeatureArea[]> {
    const rows = await this.db.select().from(featureArea).where(and(...this.conditions(criteria))).orderBy(asc(featureArea.position), asc(featureArea.id))
    return rows.map(row => FeatureArea.fromDTO(row))
  }

  /**
   * A page of a workspace's areas. Active ones in their order: the cursor is the id
   * of the last area shown, and the page goes on after its position. Retired ones
   * in the order they were created.
   */
  async page(workspaceId: string, retired: boolean, page: PageRequest): Promise<Page<FeatureArea>> {
    const criteria = { workspaceId, retired }
    const after = page.cursor ? await this.after(page.cursor, retired) : []
    const rows = await this.db
      .select()
      .from(featureArea)
      .where(and(...this.conditions(criteria), ...after))
      .orderBy(retired ? asc(featureArea.id) : asc(featureArea.position))
      .limit(page.size + 1)
    return toPage(rows.map(row => FeatureArea.fromDTO(row)), page.size, await this.count(criteria))
  }

  async count(criteria: FeatureArea_Criteria): Promise<number> {
    const [result] = await this.db.select({ total: count() }).from(featureArea).where(and(...this.conditions(criteria)))
    return result?.total ?? 0
  }


  async persist(entity: FeatureArea): Promise<FeatureArea> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(featureArea).values(dto)
    } else {
      const { id, workspaceId: _, createdAt: __, ...row } = dto
      await this.db.update(featureArea).set(row).where(eq(featureArea.id, id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private async after(cursor: string, retired: boolean) {
    if (retired) return [gt(featureArea.id, cursor)]
    const [last] = await this.db.select({ position: featureArea.position }).from(featureArea).where(eq(featureArea.id, cursor))
    return [gt(featureArea.position, last?.position ?? -1)]
  }

  private conditions(criteria: FeatureArea_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(featureArea.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(featureArea.id, criteria.id))
    if (criteria.name !== undefined) conditions.push(sql`lower(${featureArea.name}) = lower(${criteria.name.trim()})`)
    if (criteria.positions) conditions.push(between(featureArea.position, criteria.positions.from, criteria.positions.to))
    if (criteria.retired !== undefined) conditions.push(criteria.retired ? isNotNull(featureArea.retiredAt) : isNull(featureArea.retiredAt))
    return conditions
  }
}
