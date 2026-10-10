import { z } from 'zod'

export const FeatureAreaModuleName = 'feature-area'

const FeatureAreaNameSchema = z.string().trim().min(1, 'Name it').max(60, 'Keep it under 60 characters')
const FeatureAreaDescriptionSchema = z.string().trim().max(2000, 'Keep it under 2000 characters')

export const FeatureAreaSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  name: FeatureAreaNameSchema,
  /** What the area covers and what it does not. Plain text. */
  description: FeatureAreaDescriptionSchema,
  /** Where it sits among the workspace's active areas, from 0. Null once retired. */
  position: z.number().int().min(0).nullable(),
  activeFeatures: z.number().int().min(0),
  retiredAt: z.string().nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const FeatureAreaCreateSchema = z.object({
  name: FeatureAreaNameSchema,
  description: FeatureAreaDescriptionSchema.default(''),
})

export const FeatureAreaUpdateSchema = z.object({
  name: FeatureAreaNameSchema.optional(),
  description: FeatureAreaDescriptionSchema.optional(),
})

/** The new place among the active areas, from 0. Past the end means last. */
export const FeatureAreaMoveSchema = z.object({ position: z.number().int().min(0) })

export type FeatureAreaDTO = z.infer<typeof FeatureAreaSchema>
export type FeatureAreaCreateDTO = z.input<typeof FeatureAreaCreateSchema>
export type FeatureAreaUpdateDTO = z.infer<typeof FeatureAreaUpdateSchema>
export type FeatureAreaMoveDTO = z.infer<typeof FeatureAreaMoveSchema>
