import { and, asc, count, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { Delta, type DeltaChange, type DeltaCounts, type DeltaEntityDTO, type DeltaSnapshotDTO } from './delta'
import { delta, deltaReview, deltaSnapshot } from './infrastructure/delta.table'

export interface Delta_Criteria {
  proposalId?: string[]
  id?: string[]
  /** The artifacts they change. */
  targetId?: string[]
  /** Removed by a published revision. */
  gone?: boolean
  /** Published by some revision. */
  published?: boolean
}

type DeltaRow = typeof delta.$inferSelect
type SnapshotRow = typeof deltaSnapshot.$inferSelect

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

  /** A page of what one revision did to the proposal's deltas, in the order they were written. */
  async snapshots(proposalId: string, revision: number, page: PageRequest): Promise<Page<DeltaSnapshotDTO>> {
    const where = and(eq(deltaSnapshot.proposalId, proposalId), eq(deltaSnapshot.revision, revision))
    const rows = await this.db
      .select({ snapshot: deltaSnapshot, kind: delta.kind, operation: delta.operation, targetId: delta.targetId })
      .from(deltaSnapshot)
      .innerJoin(delta, eq(delta.id, deltaSnapshot.deltaId))
      .where(and(where, ...(page.cursor ? [gt(deltaSnapshot.deltaId, page.cursor)] : [])))
      .orderBy(asc(deltaSnapshot.deltaId))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(deltaSnapshot).where(where)
    const items = rows.map(({ snapshot, ...rest }) => ({ ...this.snapshotOf(snapshot), ...(rest as Pick<DeltaSnapshotDTO, 'kind' | 'operation' | 'targetId'>) }))
    return toPage(items, page.size, total?.total ?? 0)
  }

  /** What these revisions did to these deltas. */
  async snapshotsOf(deltaIds: string[], revisions: number[]): Promise<Omit<DeltaSnapshotDTO, 'kind' | 'operation' | 'targetId'>[]> {
    if (deltaIds.length === 0 || revisions.length === 0) return []
    const rows = await this.db.select().from(deltaSnapshot).where(and(inArray(deltaSnapshot.deltaId, deltaIds), inArray(deltaSnapshot.revision, revisions)))
    return rows.map(row => this.snapshotOf(row))
  }

  /** The last revision that added or changed each of these deltas, with what it said before. */
  async lastChanges(deltaIds: string[]): Promise<Map<string, Omit<DeltaSnapshotDTO, 'kind' | 'operation' | 'targetId'>>> {
    if (deltaIds.length === 0) return new Map()
    const rows = await this.db
      .select()
      .from(deltaSnapshot)
      .where(and(inArray(deltaSnapshot.deltaId, deltaIds), inArray(deltaSnapshot.change, ['added', 'changed'])))
      .orderBy(desc(deltaSnapshot.revision))
    const last = new Map<string, Omit<DeltaSnapshotDTO, 'kind' | 'operation' | 'targetId'>>()
    for (const row of rows) if (!last.has(row.deltaId)) last.set(row.deltaId, this.snapshotOf(row))
    return last
  }

  /** A page of the deltas that are part of either revision. The cursor is a delta id. */
  async inRevisions(proposalId: string, revisions: number[], page: PageRequest): Promise<Page<Delta>> {
    const where = and(eq(deltaSnapshot.proposalId, proposalId), inArray(deltaSnapshot.revision, revisions))
    const ids = this.db.selectDistinct({ id: deltaSnapshot.deltaId }).from(deltaSnapshot).where(where)
    const rows = await this.db
      .select()
      .from(delta)
      .where(and(inArray(delta.id, ids), ...(page.cursor ? [gt(delta.id, page.cursor)] : [])))
      .orderBy(asc(delta.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: sql<number>`count(distinct ${deltaSnapshot.deltaId})` }).from(deltaSnapshot).where(where)
    return toPage(await this.hydrate(rows), page.size, Number(total?.total ?? 0))
  }

  /** The reviews and the snapshot of a revision are the delta's own: they are written with it. */
  async persist(entity: Delta): Promise<Delta> {
    const dto = entity.toDTO()

    if (entity.isDeleted) {
      await this.db.delete(deltaReview).where(eq(deltaReview.deltaId, dto.id))
      await this.db.delete(delta).where(eq(delta.id, dto.id))
      return entity
    }

    const row = {
      targetLabel: dto.targetLabel,
      before: dto.before === null ? null : JSON.stringify(dto.before),
      after: dto.after === null ? null : JSON.stringify(dto.after),
      published: dto.published === null ? null : JSON.stringify(dto.published),
      removed: dto.removed,
      gone: dto.gone,
      updatedAt: dto.updatedAt,
    }
    if (entity.isNew) {
      const { reviews: _, snapshot: __, ...rest } = dto
      await this.db.insert(delta).values({ ...rest, ...row })
    } else {
      await this.db.update(delta).set(row).where(eq(delta.id, dto.id))
    }

    if (entity.hasChanged('reviews')) {
      await this.db.delete(deltaReview).where(eq(deltaReview.deltaId, dto.id))
      if (dto.reviews.length) await this.db.insert(deltaReview).values(dto.reviews.map(review => ({ deltaId: dto.id, ...review })))
    }

    if (dto.snapshot && entity.hasChanged('snapshot')) {
      const { content, previous, ...snapshot } = dto.snapshot
      await this.db.insert(deltaSnapshot).values({
        ...snapshot,
        deltaId: dto.id,
        proposalId: dto.proposalId,
        content: content === null ? null : JSON.stringify(content),
        previous: previous === null ? null : JSON.stringify(previous),
      })
    }

    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Delta_Criteria) {
    const conditions = []
    if (criteria.proposalId) conditions.push(inArray(delta.proposalId, criteria.proposalId))
    if (criteria.id) conditions.push(inArray(delta.id, criteria.id))
    if (criteria.targetId) conditions.push(inArray(delta.targetId, criteria.targetId))
    if (criteria.gone !== undefined) conditions.push(eq(delta.gone, criteria.gone))
    if (criteria.published) conditions.push(isNotNull(delta.published))
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
      published: row.published === null ? null : JSON.parse(row.published),
      snapshot: null,
      reviews: reviews
        .filter(review => review.deltaId === row.id)
        .map(({ deltaId: _, verdict, ...review }) => ({ ...review, verdict: verdict as 'approved' | 'rejected' })),
    }))
  }

  /** A snapshot row as the contract says it, without what it takes from its delta. */
  private snapshotOf(row: SnapshotRow): Omit<DeltaSnapshotDTO, 'kind' | 'operation' | 'targetId'> {
    return {
      deltaId: row.deltaId,
      revision: row.revision,
      change: row.change as DeltaChange,
      content: row.content === null ? null : JSON.parse(row.content),
      previous: row.previous === null ? null : JSON.parse(row.previous),
    }
  }
}
