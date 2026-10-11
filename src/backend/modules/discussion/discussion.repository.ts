import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { Discussion, type DiscussionCounts } from './discussion'
import { discussion } from './infrastructure/discussion.table'

export interface Discussion_Criteria {
  workspaceId?: string
  id?: string[]
  proposalId?: string
  /** On this delta; null for the proposal in general. */
  deltaId?: string | null
}

export class Discussion_Repository extends Repository<Base> {

  async find(criteria: Discussion_Criteria): Promise<Discussion[]> {
    const rows = await this.db.select().from(discussion).where(and(...this.conditions(criteria))).orderBy(asc(discussion.id))
    return rows.map(row => Discussion.fromDTO(row))
  }

  /** A page of the conversations that match, oldest first. The cursor is a discussion id. */
  async page(criteria: Discussion_Criteria, page: PageRequest): Promise<Page<Discussion>> {
    const rows = await this.db
      .select()
      .from(discussion)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [gt(discussion.id, page.cursor)] : [])))
      .orderBy(asc(discussion.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(discussion).where(and(...this.conditions(criteria)))
    return toPage(rows.map(row => Discussion.fromDTO(row)), page.size, total?.total ?? 0)
  }

  /** How many conversations match, and how many are open, by delta: '' for the proposal in general. */
  async counts(criteria: Discussion_Criteria): Promise<Map<string, DiscussionCounts>> {
    const rows = await this.db
      .select({
        deltaId: discussion.deltaId,
        discussions: count(),
        open: sql<number>`sum(case when ${discussion.resolvedAt} is null then 1 else 0 end)`,
      })
      .from(discussion)
      .where(and(...this.conditions(criteria)))
      .groupBy(discussion.deltaId)
    return new Map(rows.map(row => [row.deltaId ?? '', { discussions: row.discussions, open: Number(row.open) }]))
  }

  async persist(entity: Discussion): Promise<Discussion> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(discussion).values(dto)
    } else {
      await this.db.update(discussion).set({ resolvedAt: dto.resolvedAt, resolvedBy: dto.resolvedBy, updatedAt: dto.updatedAt }).where(eq(discussion.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Discussion_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(discussion.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(discussion.id, criteria.id))
    if (criteria.proposalId !== undefined) conditions.push(eq(discussion.proposalId, criteria.proposalId))
    if (criteria.deltaId !== undefined) conditions.push(criteria.deltaId === null ? isNull(discussion.deltaId) : eq(discussion.deltaId, criteria.deltaId))
    return conditions
  }
}
