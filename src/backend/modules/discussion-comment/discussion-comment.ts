import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { DiscussionCommentNotYours } from './errors/discussion-comment-not-yours'

export * from './discussion-comment.schema'

const DiscussionCommentEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  discussionId: z.uuidv7(),
  authorId: z.uuidv7(),
  body: z.string(),
  editedAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type DiscussionCommentEntityDTO = z.infer<typeof DiscussionCommentEntitySchema>

/** What someone said in a conversation. Edited by its author, never deleted. */
export class DiscussionComment extends Entity<typeof DiscussionCommentEntitySchema> {

  private constructor(input: EntityInput<DiscussionCommentEntityDTO>, isNew: boolean) {
    super(DiscussionCommentEntitySchema, input, isNew)
  }

  static fromDTO(dto: DiscussionCommentEntityDTO): DiscussionComment {
    return new DiscussionComment(dto, false)
  }

  static create(input: Pick<DiscussionCommentEntityDTO, 'workspaceId' | 'discussionId' | 'authorId' | 'body'>): DiscussionComment {
    return new DiscussionComment({ ...input, editedAt: null }, true)
  }

  edit(userId: string, body: string): void {
    if (userId !== this.data.authorId) throw new DiscussionCommentNotYours()
    this.change({ body, editedAt: new Date().toISOString() })
  }
}
