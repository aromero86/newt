import { and, count, desc, eq, inArray, lt, max, sql } from 'drizzle-orm'
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
  /** Words its title has, in that order; any case. */
  title?: string
}

export class Proposal_Repository extends Repository<Base> {

  async find(criteria: Proposal_Criteria): Promise<Proposal[]> {
    const rows = await this.withExtraction().where(and(...this.conditions(criteria))).orderBy(desc(proposal.id))
    return rows.map(row => this.toEntity(row))
  }

  /** A page of a workspace's proposals, newest first. The cursor is a proposal id. */
  async page(criteria: Proposal_Criteria & { workspaceId: string }, page: PageRequest): Promise<Page<Proposal>> {
    const rows = await this.withExtraction()
      .where(and(...this.conditions(criteria), ...(page.cursor ? [lt(proposal.id, page.cursor)] : [])))
      .orderBy(desc(proposal.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(proposal).where(and(...this.conditions(criteria)))
    return toPage(rows.map(row => this.toEntity(row)), page.size, total?.total ?? 0)
  }

  /** Every last revision still waiting for its deltas, in any workspace: what the server picks up again when it starts. */
  async extracting(): Promise<{ workspaceId: string, proposalId: string, revision: number }[]> {
    return this.db
      .select({ workspaceId: proposal.workspaceId, proposalId: proposal.id, revision: proposalRevision.number })
      .from(proposalRevision)
      .innerJoin(proposal, and(eq(proposal.id, proposalRevision.proposalId), eq(proposal.revision, proposalRevision.number)))
      .where(eq(proposalRevision.extraction, 'extracting'))
      .orderBy(proposalRevision.proposalId)
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
    const { newRevision, extraction: _e, extracted: _x, ...values } = dto
    if (entity.isNew) {
      await this.db.insert(proposal).values(values)
    } else {
      const { id, workspaceId: _, number: __, createdBy: ___, createdAt: ____, ...row } = values
      await this.db.update(proposal).set(row).where(eq(proposal.id, id))
    }
    // A revision is the proposal's own: written once, and completed once by its extraction.
    if (newRevision && entity.hasChanged('newRevision')) {
      await this.db.insert(proposalRevision).values({ ...newRevision, proposalId: dto.id })
    } else if (dto.extraction && (entity.hasChanged('extraction') || entity.hasChanged('extracted'))) {
      await this.db
        .update(proposalRevision)
        .set({ extraction: dto.extraction.state, extractionError: dto.extraction.error, ...(entity.hasChanged('extracted') && dto.extracted ? dto.extracted : {}) })
        .where(and(eq(proposalRevision.proposalId, dto.id), eq(proposalRevision.number, dto.revision)))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  /** Proposals with how the extraction of their last revision stands. */
  private withExtraction() {
    return this.db
      .select({ row: proposal, extraction: proposalRevision.extraction, extractionError: proposalRevision.extractionError })
      .from(proposal)
      .leftJoin(proposalRevision, and(eq(proposalRevision.proposalId, proposal.id), eq(proposalRevision.number, proposal.revision)))
      .$dynamic()
  }

  private toEntity({ row, extraction, extractionError }: { row: typeof proposal.$inferSelect, extraction: 'extracting' | 'ready' | 'failed' | null, extractionError: string | null }): Proposal {
    return Proposal.fromDTO({
      ...row,
      status: row.status as ProposalStatus,
      extraction: extraction ? { state: extraction, error: extractionError } : null,
      extracted: null,
      newRevision: null,
    })
  }

  private conditions(criteria: Proposal_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(proposal.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(proposal.id, criteria.id))
    if (criteria.number !== undefined) conditions.push(eq(proposal.number, criteria.number))
    if (criteria.status?.length) conditions.push(inArray(proposal.status, criteria.status))
    if (criteria.title?.trim()) {
      const words = criteria.title.trim().replace(/[%_\\]/g, '\\$&').split(/\s+/).join('%')
      conditions.push(sql`${proposal.title} LIKE ${`%${words}%`} ESCAPE '\\'`)
    }
    return conditions
  }
}
