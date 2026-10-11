import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { DiscussionComment } from './discussion-comment'
import { discussionComment } from './infrastructure/discussion-comment.table'

export interface DiscussionComment_Criteria {
  workspaceId?: string
  id?: string[]
  discussionId?: string[]
  /** Only the comment that started each conversation. */
  first?: boolean
}

export class DiscussionComment_Repository extends Repository<Base> {

  async find(criteria: DiscussionComment_Criteria): Promise<DiscussionComment[]> {
    const rows = await this.db.select().from(discussionComment).where(and(...this.conditions(criteria))).orderBy(asc(discussionComment.id))
    return rows.map(row => DiscussionComment.fromDTO(row))
  }

  /** A page of the comments that match, oldest first. The cursor is a comment id. */
  async page(criteria: DiscussionComment_Criteria, page: PageRequest): Promise<Page<DiscussionComment>> {
    const rows = await this.db
      .select()
      .from(discussionComment)
      .where(and(...this.conditions(criteria), ...(page.cursor ? [gt(discussionComment.id, page.cursor)] : [])))
      .orderBy(asc(discussionComment.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(discussionComment).where(and(...this.conditions(criteria)))
    return toPage(rows.map(row => DiscussionComment.fromDTO(row)), page.size, total?.total ?? 0)
  }

  /** How many comments each of these conversations has. */
  async counts(discussionIds: string[]): Promise<Map<string, number>> {
    if (discussionIds.length === 0) return new Map()
    const rows = await this.db
      .select({ discussionId: discussionComment.discussionId, total: count() })
      .from(discussionComment)
      .where(inArray(discussionComment.discussionId, discussionIds))
      .groupBy(discussionComment.discussionId)
    return new Map(rows.map(row => [row.discussionId, row.total]))
  }

  async persist(entity: DiscussionComment): Promise<DiscussionComment> {
    const dto = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(discussionComment).values(dto)
    } else {
      await this.db.update(discussionComment).set({ body: dto.body, editedAt: dto.editedAt, updatedAt: dto.updatedAt }).where(eq(discussionComment.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: DiscussionComment_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(discussionComment.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(discussionComment.id, criteria.id))
    if (criteria.discussionId) conditions.push(inArray(discussionComment.discussionId, criteria.discussionId))
    if (criteria.first) {
      conditions.push(sql`${discussionComment.id} = (select min(c.id) from discussion_comment c where c.discussion_id = ${discussionComment.discussionId})`)
    }
    return conditions
  }
}
