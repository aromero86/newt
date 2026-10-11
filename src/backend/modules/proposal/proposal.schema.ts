import { z } from 'zod'
import { DeltaInputSchema } from '../delta/delta.schema'

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
  /** How many of its deltas are in each state. */
  deltas: z.object({ total: z.number(), approved: z.number(), rejected: z.number(), pending: z.number() }),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ProposalCreateSchema = z.object({ title: ProposalTitleSchema })
export const ProposalUpdateSchema = z.object({ title: ProposalTitleSchema })

/** A proposal with one delta, made in place; its title is written for it. */
export const ProposalQuickSchema = z.object({ delta: DeltaInputSchema })

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>
export type ProposalDTO = z.infer<typeof ProposalSchema>
export type ProposalCreateDTO = z.infer<typeof ProposalCreateSchema>
export type ProposalUpdateDTO = z.infer<typeof ProposalUpdateSchema>
export type ProposalQuickDTO = z.input<typeof ProposalQuickSchema>
