import { z } from 'zod'

export const DiscussionCommentModuleName = 'discussion-comment'

export const DiscussionCommentBodySchema = z.string().trim().min(1, 'Write something').max(5000, 'Keep it under 5000 characters')

export const DiscussionCommentSchema = z.object({
  id: z.uuidv7(),
  discussionId: z.uuidv7(),
  author: z.object({ id: z.uuidv7(), nick: z.string() }),
  /** Markdown. */
  body: DiscussionCommentBodySchema,
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const DiscussionCommentInputSchema = z.object({ body: DiscussionCommentBodySchema })

export type DiscussionCommentDTO = z.infer<typeof DiscussionCommentSchema>
export type DiscussionCommentInputDTO = z.infer<typeof DiscussionCommentInputSchema>
