import { and, count, desc, eq, inArray, lt, max } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { proposal } from './infrastructure/proposal.table'
import { Proposal, type ProposalStatus } from './proposal'

export interface Proposal_Criteria {
  workspaceId?: string
  id?: string[]
  number?: number
  status?: ProposalStatus[]
}

export class Proposal_Repository extends Repository<Base> {

  async find(criteria: Proposal_Criteria): Promise<Proposal[]> {
    const rows = await this.db.select().from(proposal).where(and(...this.conditions(criteria))).orderBy(desc(proposal.id))
    return rows.map(row => Proposal.fromDTO({ ...row, status: row.status as ProposalStatus }))
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
    return toPage(rows.map(row => Proposal.fromDTO({ ...row, status: row.status as ProposalStatus })), page.size, total?.total ?? 0)
  }

  /** The next PROP-number of the workspace: numbers are never reused. */
  async nextNumber(workspaceId: string): Promise<number> {
    const [result] = await this.db.select({ last: max(proposal.number) }).from(proposal).where(eq(proposal.workspaceId, workspaceId))
    return (result?.last ?? 0) + 1
  }

  async persist(entity: Proposal): Promise<Proposal> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(proposal).values(dto)
    } else {
      const { id, workspaceId: _, number: __, createdBy: ___, createdAt: ____, ...row } = dto
      await this.db.update(proposal).set(row).where(eq(proposal.id, id))
    }
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
