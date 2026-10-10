import { z } from 'zod'

export const RuleModuleName = 'rule'

/** What kind of truth a rule states; it will decide how a pull request is checked against it. */
export const RuleKindSchema = z.enum(['permission', 'validation', 'flow', 'calculation', 'legal', 'non-functional'])

/** A concrete example: given… when… then… */
export const RuleCriterionSchema = z.object({
  given: z.string().trim().min(1, 'Say what is given').max(500, 'Keep it under 500 characters'),
  when: z.string().trim().min(1, 'Say what happens').max(500, 'Keep it under 500 characters'),
  then: z.string().trim().min(1, 'Say what follows').max(500, 'Keep it under 500 characters'),
})

/**
 * Where a rule applies: for each dimension it names, the values it applies in. A
 * dimension it does not name applies in all its values; an empty scope, everywhere.
 */
export const RuleScopeSchema = z.array(z.object({
  dimensionId: z.uuidv7(),
  valueIds: z.array(z.uuidv7()).min(1, 'Pick at least one value'),
}))

/** Everything a version of a rule says. */
export const RuleDraftSchema = z.object({
  kind: RuleKindSchema,
  statement: z.string().trim().min(1, 'State the rule').max(500, 'Keep it under 500 characters'),
  why: z.string().trim().min(1, 'Say why it holds').max(2000, 'Keep it under 2000 characters'),
  scope: RuleScopeSchema.default([]),
  criteria: z.array(RuleCriterionSchema).max(20, 'At most 20 criteria').default([]),
})

export const RuleVersionSchema = RuleDraftSchema.extend({
  id: z.uuidv7(),
  /** From 1; each new version replaces the one before. */
  version: z.number().int().min(1),
  createdAt: z.string(),
})

export const RuleSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  /** Short and stable across versions: R-7. */
  key: z.string(),
  number: z.number().int().min(1),
  featureId: z.uuidv7(),
  featureName: z.string(),
  retiredAt: z.string().nullable(),
  /** The version in force, or the last one if retired. */
  current: RuleVersionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const RuleCreateSchema = RuleDraftSchema.extend({ featureId: z.uuidv7() })

/** Which rules to list: of one feature, retired or not, applying in these values. */
export type RuleFilter = {
  featureId?: string
  retired: boolean
  /** One value per dimension: the rules that apply in all of them. */
  appliesIn: { dimensionId: string, valueId: string }[]
}

export type RuleKind = z.infer<typeof RuleKindSchema>
export type RuleCriterionDTO = z.infer<typeof RuleCriterionSchema>
export type RuleScopeDTO = z.infer<typeof RuleScopeSchema>
export type RuleDraftDTO = z.input<typeof RuleDraftSchema>
export type RuleVersionDTO = z.infer<typeof RuleVersionSchema>
export type RuleDTO = z.infer<typeof RuleSchema>
export type RuleCreateDTO = z.input<typeof RuleCreateSchema>
