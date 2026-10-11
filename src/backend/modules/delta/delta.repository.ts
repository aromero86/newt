import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { Delta, type DeltaCounts, type DeltaEntityDTO } from './delta'
import { delta, deltaReview } from './infrastructure/delta.table'

export interface Delta_Criteria {
  proposalId?: string[]
  id?: string[]
  /** The artifacts they change. */
  targetId?: string[]
}

type DeltaRow = typeof delta.$inferSelect

const rejected = sql`exists (select 1 from delta__review r where r.delta_id = ${delta.id} and r.verdict = 'rejected')`
const approved = sql`exists (select 1 from delta__review r where r.delta_id = ${delta.id} and r.verdict = 'approved')`

export class Delta_Repository extends Repository<Base> {

  /** In the order they were written, which is the order they are applied in. */
  async find(criteria: Delta_Criteria): Promise<Delta[]> {
    return this.hydrate(await this.db.select().from(delta).where(and(...this.conditions(criteria))).orderBy(asc(delta.id)))
  }

  /** A page of the deltas that match, in the order they were written. The cursor is a delta id. */
  async page(criteria: Delta_Criteria, page: PageRequest): Promise<Page<Delta>> {
    const rows = await this.db
      .select()
      .from(delta)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [gt(delta.id, page.cursor)] : [])))
      .orderBy(asc(delta.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(delta).where(and(...this.conditions(criteria)))
    return toPage(await this.hydrate(rows), page.size, total?.total ?? 0)
  }

  /** How many of the deltas that match are pending, approved and rejected, by proposal. */
  async counts(criteria: Delta_Criteria): Promise<Map<string, DeltaCounts>> {
    const rows = await this.db
      .select({
        proposalId: delta.proposalId,
        total: count(),
        rejected: sql<number>`sum(case when ${rejected} then 1 else 0 end)`,
        approved: sql<number>`sum(case when not ${rejected} and ${approved} then 1 else 0 end)`,
      })
      .from(delta)
      .where(and(...this.conditions(criteria)))
      .groupBy(delta.proposalId)
    return new Map(rows.map(row => [row.proposalId, {
      total: row.total,
      approved: Number(row.approved),
      rejected: Number(row.rejected),
      pending: row.total - Number(row.approved) - Number(row.rejected),
    }]))
  }

  /** The reviews are the delta's own: they follow it, written again whenever they change. */
  async persist(entity: Delta): Promise<Delta> {
    const dto = entity.toDTO()

    if (entity.isDeleted) {
      await this.db.delete(deltaReview).where(eq(deltaReview.deltaId, dto.id))
      await this.db.delete(delta).where(eq(delta.id, dto.id))
      return entity
    }

    const row = { targetLabel: dto.targetLabel, before: dto.before === null ? null : JSON.stringify(dto.before), after: dto.after === null ? null : JSON.stringify(dto.after), updatedAt: dto.updatedAt }
    if (entity.isNew) {
      const { reviews: _, ...rest } = dto
      await this.db.insert(delta).values({ ...rest, ...row })
    } else {
      await this.db.update(delta).set(row).where(eq(delta.id, dto.id))
    }

    if (entity.hasChanged('reviews')) {
      await this.db.delete(deltaReview).where(eq(deltaReview.deltaId, dto.id))
      if (dto.reviews.length) await this.db.insert(deltaReview).values(dto.reviews.map(review => ({ deltaId: dto.id, ...review })))
    }

    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Delta_Criteria) {
    const conditions = []
    if (criteria.proposalId) conditions.push(inArray(delta.proposalId, criteria.proposalId))
    if (criteria.id) conditions.push(inArray(delta.id, criteria.id))
    if (criteria.targetId) conditions.push(inArray(delta.targetId, criteria.targetId))
    return conditions
  }

  private async hydrate(rows: DeltaRow[]): Promise<Delta[]> {
    if (rows.length === 0) return []
    const reviews = await this.db.select().from(deltaReview).where(inArray(deltaReview.deltaId, rows.map(row => row.id))).orderBy(asc(deltaReview.at))
    return rows.map(row => Delta.fromDTO({
      ...row,
      kind: row.kind as DeltaEntityDTO['kind'],
      operation: row.operation as DeltaEntityDTO['operation'],
      before: row.before === null ? null : JSON.parse(row.before),
      after: row.after === null ? null : JSON.parse(row.after),
      reviews: reviews
        .filter(review => review.deltaId === row.id)
        .map(({ deltaId: _, verdict, ...review }) => ({ ...review, verdict: verdict as 'approved' | 'rejected' })),
    }))
  }
}
