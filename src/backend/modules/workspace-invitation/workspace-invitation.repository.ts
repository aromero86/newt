import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { workspaceInvitation } from './infrastructure/workspace-invitation.table'
import { WorkspaceInvitation } from './workspace-invitation'

export interface WorkspaceInvitation_Criteria {
  id?: string[]
  workspaceId?: string
  email?: string
  /** Neither accepted, cancelled nor expired. */
  pending?: boolean
}

export class WorkspaceInvitation_Repository extends Repository<Base> {

  async find(criteria: WorkspaceInvitation_Criteria): Promise<WorkspaceInvitation[]> {
    const rows = await this.db.select().from(workspaceInvitation).where(and(...this.conditions(criteria))).orderBy(asc(workspaceInvitation.id))
    return rows.map(row => WorkspaceInvitation.fromDTO(row))
  }

  /** A workspace's pending invitations, oldest first. The cursor is an invitation id. */
  async pageOfPending(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceInvitation>> {
    const conditions = this.conditions({ workspaceId, pending: true })
    const rows = await this.db
      .select()
      .from(workspaceInvitation)
      .where(and(...conditions, ...(page.cursor ? [gt(workspaceInvitation.id, page.cursor)] : [])))
      .orderBy(asc(workspaceInvitation.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(workspaceInvitation).where(and(...conditions))
    return toPage(rows.map(row => WorkspaceInvitation.fromDTO(row)), page.size, total?.total ?? 0)
  }

  private conditions(criteria: WorkspaceInvitation_Criteria) {
    const conditions = []
    if (criteria.id) conditions.push(inArray(workspaceInvitation.id, criteria.id))
    if (criteria.workspaceId !== undefined) conditions.push(eq(workspaceInvitation.workspaceId, criteria.workspaceId))
    if (criteria.email !== undefined) conditions.push(eq(workspaceInvitation.email, criteria.email.trim().toLowerCase()))
    if (criteria.pending) {
      conditions.push(isNull(workspaceInvitation.acceptedAt), isNull(workspaceInvitation.cancelledAt), gt(workspaceInvitation.expiresAt, new Date().toISOString()))
    }
    return conditions
  }

  async persist(entity: WorkspaceInvitation): Promise<WorkspaceInvitation> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(workspaceInvitation).values(dto)
    } else {
      await this.db
        .update(workspaceInvitation)
        .set({ acceptedAt: dto.acceptedAt, cancelledAt: dto.cancelledAt, updatedAt: dto.updatedAt })
        .where(eq(workspaceInvitation.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }
}
