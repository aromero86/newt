import { z } from 'zod'

export const FeatureModuleName = 'feature'

const FeatureNameSchema = z.string().trim().min(1, 'Name it').max(80, 'Keep it under 80 characters')
const FeatureDescriptionSchema = z.string().trim().max(2000, 'Keep it under 2000 characters')

export const FeatureSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  areaId: z.uuidv7(),
  name: FeatureNameSchema,
  /** What the feature covers and what it does not. Plain text. */
  description: FeatureDescriptionSchema,
  /** Where it sits among its area's active features, from 0. Null once retired. */
  position: z.number().int().min(0).nullable(),
  retiredAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const FeatureCreateSchema = z.object({
  areaId: z.uuidv7(),
  name: FeatureNameSchema,
  description: FeatureDescriptionSchema.default(''),
})

export const FeatureUpdateSchema = z.object({
  name: FeatureNameSchema.optional(),
  description: FeatureDescriptionSchema.optional(),
})

/**
 * Where the feature goes: another area (at its end, unless a position is given), a
 * new place in its own (from 0; past the end means last), or both.
 */
export const FeatureMoveSchema = z.object({
  areaId: z.uuidv7().optional(),
  position: z.number().int().min(0).optional(),
})

export type FeatureDTO = z.infer<typeof FeatureSchema>
export type FeatureCreateDTO = z.input<typeof FeatureCreateSchema>
export type FeatureUpdateDTO = z.infer<typeof FeatureUpdateSchema>
export type FeatureMoveDTO = z.infer<typeof FeatureMoveSchema>
