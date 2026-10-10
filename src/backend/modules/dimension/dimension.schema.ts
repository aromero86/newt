import { z } from 'zod'

export const DimensionModuleName = 'dimension'

/** At most this many dimensions per workspace, and values per dimension: lists bounded by design. */
export const DimensionLimits = { dimensions: 20, values: 50 } as const

const DimensionNameSchema = z.string().trim().min(1, 'Name it').max(60, 'Keep it under 60 characters')

export const DimensionValueSchema = z.object({
  id: z.uuidv7(),
  name: DimensionNameSchema,
  /** Retired values stay, so whatever used them keeps its meaning. */
  retiredAt: z.string().nullable(),
})

export const DimensionSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  name: DimensionNameSchema,
  /** In order: the first one first. */
  values: z.array(DimensionValueSchema),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const DimensionNameInputSchema = z.object({ name: DimensionNameSchema })

/** Every id of the list, in the new order. */
export const DimensionOrderSchema = z.object({ order: z.array(z.uuidv7()).min(1) })

export type DimensionDTO = z.infer<typeof DimensionSchema>
export type DimensionValueDTO = z.infer<typeof DimensionValueSchema>
export type DimensionNameInputDTO = z.infer<typeof DimensionNameInputSchema>
export type DimensionOrderDTO = z.infer<typeof DimensionOrderSchema>
