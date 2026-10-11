import { z } from 'zod'
import { RuleCriterionSchema, RuleKindSchema, RuleScopeSchema } from '../rule/rule.schema'

export const ReleaseModuleName = 'release'

/** The kinds of artifact a release pictures; each new kind joins when its phase comes. */
export const ReleaseArtifactKindSchema = z.enum(['dimension', 'feature-area', 'feature', 'rule'])

/** An artifact as a release pictures it: what defines it, and whether it was retired. */
export const ReleaseArtifactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dimension'),
    id: z.uuidv7(),
    name: z.string(),
    values: z.array(z.object({ id: z.uuidv7(), name: z.string(), retired: z.boolean() })),
    retired: z.boolean(),
  }),
  z.object({ kind: z.literal('feature-area'), id: z.uuidv7(), name: z.string(), description: z.string(), retired: z.boolean() }),
  z.object({ kind: z.literal('feature'), id: z.uuidv7(), areaId: z.uuidv7(), areaName: z.string(), name: z.string(), description: z.string(), retired: z.boolean() }),
  z.object({
    kind: z.literal('rule'),
    id: z.uuidv7(),
    key: z.string(),
    featureId: z.uuidv7(),
    featureName: z.string(),
    areaName: z.string(),
    ruleKind: RuleKindSchema,
    statement: z.string(),
    why: z.string(),
    scope: RuleScopeSchema,
    criteria: z.array(RuleCriterionSchema),
    retired: z.boolean(),
  }),
])

/** What happened to an artifact between two pictures. */
export const ReleaseChangeKindSchema = z.enum(['added', 'changed', 'retired', 'restored'])

/** One artifact that differs between two pictures, with the proposals that changed it in between. */
export const ReleaseChangeSchema = z.object({
  /** The artifact's id: the cursor of the pages of changes. */
  id: z.uuidv7(),
  kind: ReleaseArtifactKindSchema,
  change: ReleaseChangeKindSchema,
  /** Its name, or its key for a rule. */
  label: z.string(),
  before: ReleaseArtifactSchema.nullable(),
  after: ReleaseArtifactSchema.nullable(),
  proposals: z.array(z.object({ key: z.string(), title: z.string() })),
})

const ReleaseCountsSchema = z.object({ added: z.number(), changed: z.number(), retired: z.number(), restored: z.number() })

export const ReleaseSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  name: z.string(),
  description: z.string(),
  publishedBy: z.object({ id: z.uuidv7(), nick: z.string() }),
  publishedAt: z.string(),
  /** What changed since the release before it. */
  changes: ReleaseCountsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ReleasePublishSchema = z.object({
  name: z.string().trim().min(1, 'Name it: v2.4.0, for instance').max(40, 'Keep it under 40 characters'),
  description: z.string().trim().max(2000, 'Keep it under 2000 characters').default(''),
})

/** A document to read without newt: Markdown, and the name to save it as. */
export const ReleaseDocumentSchema = z.object({ fileName: z.string(), markdown: z.string() })

export type ReleaseArtifactKind = z.infer<typeof ReleaseArtifactKindSchema>
export type ReleaseArtifactDTO = z.infer<typeof ReleaseArtifactSchema>
export type ReleaseChangeKind = z.infer<typeof ReleaseChangeKindSchema>
export type ReleaseChangeDTO = z.infer<typeof ReleaseChangeSchema>
export type ReleaseCounts = z.infer<typeof ReleaseCountsSchema>
export type ReleaseDTO = z.infer<typeof ReleaseSchema>
export type ReleasePublishDTO = z.input<typeof ReleasePublishSchema>
export type ReleaseDocumentDTO = z.infer<typeof ReleaseDocumentSchema>
