import { and, asc, count, desc, eq, gt, inArray, lt } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { workspaceMember } from './infrastructure/workspace-member.table'
import { WorkspaceMember } from './workspace-member'

export interface WorkspaceMember_Criteria {
  workspaceId?: string
  userId?: string[]
  active?: boolean
}

export class WorkspaceMember_Repository extends Repository<Base> {

  async find(criteria: WorkspaceMember_Criteria): Promise<WorkspaceMember[]> {
    const rows = await this.db.select().from(workspaceMember).where(and(...this.conditions(criteria))).orderBy(asc(workspaceMember.id))
    return rows.map(row => WorkspaceMember.fromDTO(row))
  }

  /** A workspace's members, in the order they joined. The cursor is a membership id. */
  async pageOfWorkspace(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceMember>> {
    const criteria = { workspaceId }
    const rows = await this.db
      .select()
      .from(workspaceMember)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [gt(workspaceMember.id, page.cursor)] : [])))
      .orderBy(asc(workspaceMember.id))
      .limit(page.size + 1)
    return toPage(rows.map(row => WorkspaceMember.fromDTO(row)), page.size, await this.count(criteria))
  }

  /**
   * A user's active memberships, newest workspace first. The cursor is a workspace
   * id: workspace ids are v7, so this is the order the workspaces were created in.
   */
  async pageOfUser(userId: string, page: PageRequest): Promise<Page<WorkspaceMember>> {
    const criteria = { userId: [userId], active: true }
    const rows = await this.db
      .select()
      .from(workspaceMember)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [lt(workspaceMember.workspaceId, page.cursor)] : [])))
      .orderBy(desc(workspaceMember.workspaceId))
      .limit(page.size + 1)
    return toPage(rows.map(row => WorkspaceMember.fromDTO(row)), page.size, await this.count(criteria))
  }

  async persist(entity: WorkspaceMember): Promise<WorkspaceMember> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(workspaceMember).values(dto)
    } else {
      await this.db
        .update(workspaceMember)
        .set({ role: dto.role, active: dto.active, updatedAt: dto.updatedAt })
        .where(eq(workspaceMember.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private async count(criteria: WorkspaceMember_Criteria): Promise<number> {
    const [result] = await this.db.select({ total: count() }).from(workspaceMember).where(and(...this.conditions(criteria)))
    return result?.total ?? 0
  }

  private conditions(criteria: WorkspaceMember_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(workspaceMember.workspaceId, criteria.workspaceId))
    if (criteria.userId) conditions.push(inArray(workspaceMember.userId, criteria.userId))
    if (criteria.active !== undefined) conditions.push(eq(workspaceMember.active, criteria.active))
    return conditions
  }
}
