import { z } from 'zod'
import { DeltaInputSchema } from '../delta/delta.schema'

/** Markdown: context, problem, decisions and open questions. */
const ProposalDocumentSchema = z.string().max(50_000, 'Keep it under 50,000 characters')

export const ProposalModuleName = 'proposal'

/** draft ⇄ in review → accepted → merged; or discarded, from any state before merged. */
export const ProposalStatusSchema = z.enum(['draft', 'in review', 'accepted', 'merged', 'discarded'])

const ProposalTitleSchema = z.string().trim().min(1, 'Give it a title').max(120, 'Keep it under 120 characters')

const ProposalPersonSchema = z.object({ id: z.uuidv7(), nick: z.string() })

export const ProposalSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  /** PROP-42: per workspace, never reused. */
  key: z.string(),
  number: z.number().int().min(1),
  title: ProposalTitleSchema,
  status: ProposalStatusSchema,
  /** Made from one point of the definition, with a single delta. */
  quick: z.boolean(),
  createdBy: ProposalPersonSchema,
  acceptedBy: ProposalPersonSchema.nullable(),
  acceptedAt: z.string().nullable(),
  mergedBy: ProposalPersonSchema.nullable(),
  mergedAt: z.string().nullable(),
  discardedBy: ProposalPersonSchema.nullable(),
  discardedAt: z.string().nullable(),
  /** How many of its published deltas are in each state. */
  deltas: z.object({ total: z.number(), approved: z.number(), rejected: z.number(), pending: z.number() }),
  /** The working copy of its document. */
  document: ProposalDocumentSchema,
  /** The last revision published; 0 while none is. */
  revision: z.number().int().min(0),
  /** The working copy (document or deltas) says something the last revision did not. */
  unpublished: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ProposalCreateSchema = z.object({ title: ProposalTitleSchema })
export const ProposalUpdateSchema = z.object({ title: ProposalTitleSchema })

export const ProposalDocumentInputSchema = z.object({ document: ProposalDocumentSchema })

/** Like a commit message: what this iteration changes. */
export const ProposalPublishSchema = z.object({ message: z.string().trim().min(1, 'Say what this revision changes').max(200, 'Keep it under 200 characters') })

/** Sending to review publishes the working copy if it has changes: then it needs a message. */
export const ProposalSubmitSchema = z.object({ message: z.string().trim().max(200, 'Keep it under 200 characters').optional() })

/** A published iteration of a proposal: never edited nor deleted. */
export const ProposalRevisionSchema = z.object({
  /** Its number, as text: the cursor of its pages. */
  id: z.string(),
  number: z.number().int().min(1),
  message: z.string(),
  document: z.string(),
  publishedBy: ProposalPersonSchema,
  publishedAt: z.string(),
  /** What it did to the deltas, and whether it changed the document. */
  added: z.number(),
  changed: z.number(),
  removed: z.number(),
  documentChanged: z.boolean(),
  /** The AI assistant it was written with, by the name it gives itself (`claude-code`); null when written by hand. */
  assistant: z.string().nullable(),
})

/**
 * A delta an iteration adds. `ref` names it, so that the deltas after it in the same
 * iteration can use the artifact it creates: they write `ref:<name>` where its id goes.
 */
const ProposalIterationAddSchema = DeltaInputSchema.extend({ ref: z.string().trim().min(1).max(40).optional() })

/** A delta an iteration rewrites, by its id. */
const ProposalIterationRewriteSchema = DeltaInputSchema.extend({ id: z.uuidv7() })

/**
 * One iteration, published at once as the next revision: what changes in the
 * title, the document and the deltas. `basedOn` is the revision it was written
 * from: if another one came after it, nothing is written.
 */
export const ProposalIterateSchema = z.object({
  basedOn: z.number().int().min(0),
  message: ProposalPublishSchema.shape.message,
  title: ProposalTitleSchema.optional(),
  document: ProposalDocumentSchema.optional(),
  add: z.array(ProposalIterationAddSchema).max(50, 'At most 50 deltas at a time').default([]),
  rewrite: z.array(ProposalIterationRewriteSchema).max(50, 'At most 50 deltas at a time').default([]),
  remove: z.array(z.uuidv7()).max(50, 'At most 50 deltas at a time').default([]),
})

/** A draft written whole: its title, document and deltas, published as its first revision. */
export const ProposalWriteSchema = z.object({
  title: ProposalTitleSchema,
  message: ProposalPublishSchema.shape.message,
  document: ProposalDocumentSchema.default(''),
  add: z.array(ProposalIterationAddSchema).max(50, 'At most 50 deltas at a time').default([]),
})

/** A proposal with one delta, made in place; its title is written for it. */
export const ProposalQuickSchema = z.object({ delta: DeltaInputSchema })

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>
export type ProposalDTO = z.infer<typeof ProposalSchema>
export type ProposalCreateDTO = z.infer<typeof ProposalCreateSchema>
export type ProposalUpdateDTO = z.infer<typeof ProposalUpdateSchema>
export type ProposalQuickDTO = z.input<typeof ProposalQuickSchema>
export type ProposalDocumentInputDTO = z.infer<typeof ProposalDocumentInputSchema>
export type ProposalPublishDTO = z.infer<typeof ProposalPublishSchema>
export type ProposalSubmitDTO = z.infer<typeof ProposalSubmitSchema>
export type ProposalRevisionDTO = z.infer<typeof ProposalRevisionSchema>
export type ProposalIterateDTO = z.input<typeof ProposalIterateSchema>
export type ProposalWriteDTO = z.input<typeof ProposalWriteSchema>
