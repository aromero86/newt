import { z } from 'zod'
import { DiscussionCommentBodySchema, DiscussionCommentSchema } from '../discussion-comment/discussion-comment.schema'

export const DiscussionModuleName = 'discussion'

const DiscussionPersonSchema = z.object({ id: z.uuidv7(), nick: z.string() })

/** A conversation on a proposal, or on one of its deltas. */
export const DiscussionSchema = z.object({
  id: z.uuidv7(),
  proposalId: z.uuidv7(),
  /** On this delta, or on the proposal in general when null. */
  deltaId: z.uuidv7().nullable(),
  /** The last revision published when it started: what it talks about. */
  revision: z.number().int().min(0),
  startedBy: DiscussionPersonSchema,
  resolvedAt: z.string().nullable(),
  resolvedBy: DiscussionPersonSchema.nullable(),
  /** The comment that started it. */
  first: DiscussionCommentSchema,
  /** How many comments it has, the first one included. */
  comments: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** A new conversation, on the proposal or on one of its deltas, with its first comment. */
export const DiscussionStartSchema = z.object({
  body: DiscussionCommentBodySchema,
  deltaId: z.uuidv7().optional(),
})

/** How many conversations there are, and how many are still open. */
export type DiscussionCounts = { discussions: number, open: number }

export type DiscussionDTO = z.infer<typeof DiscussionSchema>
export type DiscussionStartDTO = z.infer<typeof DiscussionStartSchema>
