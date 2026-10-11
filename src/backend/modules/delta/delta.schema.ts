import { z } from 'zod'
import { DimensionLimits, DimensionNameInputSchema, type DimensionDTO } from '../dimension/dimension.schema'
import { FeatureAreaCreateSchema, type FeatureAreaDTO } from '../feature-area/feature-area.schema'
import { FeatureCreateSchema, type FeatureDTO } from '../feature/feature.schema'
import { RuleCreateSchema, RuleDraftSchema, type RuleDTO } from '../rule/rule.schema'

export const DeltaModuleName = 'delta'

/** What a delta changes: one artifact of one of these kinds. */
export const DeltaKindSchema = z.enum(['dimension', 'feature-area', 'feature', 'rule'])
export const DeltaOperationSchema = z.enum(['create', 'change', 'retire', 'restore'])
export const DeltaVerdictSchema = z.enum(['approved', 'rejected'])

/** A dimension as a delta leaves it: its name and every value, retired ones too. New values come without an id. */
export const DeltaDimensionStateSchema = z.object({
  name: DimensionNameInputSchema.shape.name,
  values: z.array(z.object({
    id: z.uuidv7().optional(),
    name: DimensionNameInputSchema.shape.name,
    retired: z.boolean().default(false),
  })).max(DimensionLimits.values, `At most ${DimensionLimits.values} values`),
})

export const DeltaFeatureAreaStateSchema = FeatureAreaCreateSchema
export const DeltaFeatureStateSchema = FeatureCreateSchema
export const DeltaRuleCreateStateSchema = RuleCreateSchema
/** A rule changes by a new version: it keeps its feature. */
export const DeltaRuleChangeStateSchema = RuleDraftSchema

/**
 * A delta as it is written. `targetId` is what it changes; a delta that creates
 * leaves it out, and gets the id the new artifact will have. `after` is the state
 * it leaves the artifact in: needed to create or change, absent to retire or restore.
 */
export const DeltaInputSchema = z.object({
  kind: DeltaKindSchema,
  operation: DeltaOperationSchema,
  targetId: z.uuidv7().optional(),
  after: z.unknown().optional(),
})

export const DeltaReviewSchema = z.object({
  userId: z.uuidv7(),
  nick: z.string(),
  verdict: DeltaVerdictSchema,
  /** Why it was rejected. */
  reason: z.string(),
  at: z.string(),
})

/** `approved`: at least one approval and no rejection. One rejection is enough for `rejected`. */
export const DeltaStatusSchema = z.enum(['pending', 'approved', 'rejected'])

export const DeltaSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  proposalId: z.uuidv7(),
  kind: DeltaKindSchema,
  operation: DeltaOperationSchema,
  targetId: z.uuidv7(),
  /** How the target is called: its name, or its key for a rule (R-7, or "new rule"). */
  targetLabel: z.string(),
  /** The artifact as it was when the delta was written; null when it creates. */
  before: z.unknown().nullable(),
  /** The state the delta leaves it in; null when it retires or restores. */
  after: z.unknown().nullable(),
  status: DeltaStatusSchema,
  reviews: z.array(DeltaReviewSchema),
  /** What keeps it from going ahead, such as rules still using a value it retires. */
  blockers: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const DeltaReviewInputSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('approved') }),
  z.object({ verdict: z.literal('rejected'), reason: z.string().trim().min(1, 'Say why').max(2000, 'Keep it under 2000 characters') }),
])

export type DeltaKind = z.infer<typeof DeltaKindSchema>
export type DeltaOperation = z.infer<typeof DeltaOperationSchema>
export type DeltaVerdict = z.infer<typeof DeltaVerdictSchema>
export type DeltaStatus = z.infer<typeof DeltaStatusSchema>
export type DeltaInputDTO = z.input<typeof DeltaInputSchema>
export type DeltaReviewDTO = z.infer<typeof DeltaReviewSchema>
export type DeltaReviewInputDTO = z.input<typeof DeltaReviewInputSchema>
export type DeltaDTO = z.infer<typeof DeltaSchema>
export type DeltaDimensionState = z.infer<typeof DeltaDimensionStateSchema>
export type DeltaFeatureAreaState = z.infer<typeof DeltaFeatureAreaStateSchema>
export type DeltaFeatureState = z.infer<typeof DeltaFeatureStateSchema>
export type DeltaRuleCreateState = z.infer<typeof DeltaRuleCreateStateSchema>
export type DeltaRuleChangeState = z.infer<typeof DeltaRuleChangeStateSchema>

/** What each kind of artifact looks like before a delta: as its module returns it. */
export type DeltaBefore = DimensionDTO | FeatureAreaDTO | FeatureDTO | RuleDTO

/** How many of a proposal's deltas are in each state. */
export type DeltaCounts = { total: number, approved: number, rejected: number, pending: number }
