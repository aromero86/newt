import { z } from 'zod'
import { DeltaInputSchema } from '../delta/delta.schema'
import { ExtractionQuestionSchema } from '../extraction/extraction.schema'

/** Markdown: context, problem, decisions and open questions. */
const ProposalDocumentSchema = z.string().max(50_000, 'Keep it under 50,000 characters')

export const ProposalModuleName = 'proposal'

/** draft ⇄ in review → accepted → merged; or discarded, from any state before merged. */
export const ProposalStatusSchema = z.enum(['draft', 'in review', 'accepted', 'merged', 'discarded'])

const ProposalTitleSchema = z.string().trim().min(1, 'Give it a title').max(120, 'Keep it under 120 characters')

const ProposalPersonSchema = z.object({ id: z.uuidv7(), nick: z.string() })

/**
 * Reading a revision's document for its deltas, in the background: `extracting`
 * until it ends, then `ready` with its deltas published, or `failed`, to retry.
 */
export const ProposalExtractionStateSchema = z.enum(['extracting', 'ready', 'failed'])

/** How the extraction of a revision stands, with why it failed when it did. */
export const ProposalExtractionSchema = z.object({ state: ProposalExtractionStateSchema, error: z.string().nullable() })

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
  /** The extraction of its last revision; null while none is published. Reviewing waits until it is `ready`. */
  extraction: ProposalExtractionSchema.nullable(),
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
  /** What the extraction could not settle from its document, for its author to answer in the next revision. */
  questions: z.array(ExtractionQuestionSchema),
  /** Its deltas, counts and questions are there once it is `ready`. */
  extraction: ProposalExtractionStateSchema,
  /** Why its extraction failed; null unless it did. */
  extractionError: z.string().nullable(),
})

/**
 * One iteration, as an assistant writes it: the whole new document (and title),
 * published at once as the next revision, whose deltas are extracted from it in the background.
 * `basedOn` is the revision it was written from: if another came after it, nothing
 * is written.
 */
export const ProposalIterateSchema = z.object({
  basedOn: z.number().int().min(0),
  message: ProposalPublishSchema.shape.message,
  title: ProposalTitleSchema.optional(),
  document: ProposalDocumentSchema.optional(),
})

/** A draft written whole, as an assistant writes it: its first revision, whose deltas are extracted from its document in the background. */
export const ProposalWriteSchema = z.object({
  title: ProposalTitleSchema,
  message: ProposalPublishSchema.shape.message,
  document: ProposalDocumentSchema,
})

/** A proposal with one delta, made in place; its title is written for it. */
export const ProposalQuickSchema = z.object({ delta: DeltaInputSchema })

/** A proposal published a revision, was retitled or changed state: what readers of proposals react to. */
export type ProposalChangedPayload = { workspaceId: string, proposalId: string }

/** A revision waits for its deltas to be extracted from its document. */
export type ProposalExtractionRequestedPayload = { workspaceId: string, proposalId: string, revision: number }

/** What approving every delta still to review did: how many the person approved. */
export type ProposalApproveAllDTO = { approved: number }

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>
export type ProposalExtractionState = z.infer<typeof ProposalExtractionStateSchema>
export type ProposalExtractionDTO = z.infer<typeof ProposalExtractionSchema>
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
