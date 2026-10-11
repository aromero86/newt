import { and, count, desc, eq, inArray, lt, max } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { proposal, proposalRevision } from './infrastructure/proposal.table'
import { Proposal, type ProposalStatus } from './proposal'

/** A revision as its table keeps it. */
export type ProposalRevisionRow = typeof proposalRevision.$inferSelect

export interface Proposal_Criteria {
  workspaceId?: string
  id?: string[]
  number?: number
  status?: ProposalStatus[]
}

export class Proposal_Repository extends Repository<Base> {

  async find(criteria: Proposal_Criteria): Promise<Proposal[]> {
    const rows = await this.db.select().from(proposal).where(and(...this.conditions(criteria))).orderBy(desc(proposal.id))
    return rows.map(row => Proposal.fromDTO({ ...row, status: row.status as ProposalStatus, newRevision: null }))
  }

  /** A page of a workspace's proposals, newest first. The cursor is a proposal id. */
  async page(workspaceId: string, status: ProposalStatus[] | undefined, page: PageRequest): Promise<Page<Proposal>> {
    const criteria = { workspaceId, status }
    const rows = await this.db
      .select()
      .from(proposal)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [lt(proposal.id, page.cursor)] : [])))
      .orderBy(desc(proposal.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(proposal).where(and(...this.conditions(criteria)))
    return toPage(rows.map(row => Proposal.fromDTO({ ...row, status: row.status as ProposalStatus, newRevision: null })), page.size, total?.total ?? 0)
  }

  /** A page of a proposal's revisions, newest first. The cursor is a revision number. */
  async revisions(proposalId: string, page: PageRequest): Promise<Page<ProposalRevisionRow>> {
    const rows = await this.db
      .select()
      .from(proposalRevision)
      .where(and(eq(proposalRevision.proposalId, proposalId), ...(page.cursor ? [lt(proposalRevision.number, Number(page.cursor))] : [])))
      .orderBy(desc(proposalRevision.number))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(proposalRevision).where(eq(proposalRevision.proposalId, proposalId))
    return toPage(rows, page.size, total?.total ?? 0)
  }

  async revision(proposalId: string, number: number): Promise<ProposalRevisionRow | undefined> {
    const [row] = await this.db.select().from(proposalRevision).where(and(eq(proposalRevision.proposalId, proposalId), eq(proposalRevision.number, number)))
    return row
  }

  /** The next PROP-number of the workspace: numbers are never reused. */
  async nextNumber(workspaceId: string): Promise<number> {
    const [result] = await this.db.select({ last: max(proposal.number) }).from(proposal).where(eq(proposal.workspaceId, workspaceId))
    return (result?.last ?? 0) + 1
  }

  async persist(entity: Proposal): Promise<Proposal> {
    const dto = entity.toDTO()
    const { newRevision, ...values } = dto
    if (entity.isNew) {
      await this.db.insert(proposal).values(values)
    } else {
      const { id, workspaceId: _, number: __, createdBy: ___, createdAt: ____, ...row } = values
      await this.db.update(proposal).set(row).where(eq(proposal.id, id))
    }
    // A revision is the proposal's own: written once, never changed.
    if (newRevision && entity.hasChanged('newRevision')) await this.db.insert(proposalRevision).values({ ...newRevision, proposalId: dto.id })
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Proposal_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(proposal.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(proposal.id, criteria.id))
    if (criteria.number !== undefined) conditions.push(eq(proposal.number, criteria.number))
    if (criteria.status?.length) conditions.push(inArray(proposal.status, criteria.status))
    return conditions
  }
}
