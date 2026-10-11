import { z } from 'zod'
import { DeltaSchema } from '../delta/delta.schema'

export const BaselineModuleName = 'baseline'

/**
 * A delta with its proposal: planned, when the proposal is accepted and not merged
 * yet; history, once it is merged.
 */
export const BaselinePlannedSchema = z.object({
  proposal: z.object({ id: z.uuidv7(), key: z.string(), title: z.string() }),
  delta: DeltaSchema,
})

export type BaselinePlannedDTO = z.infer<typeof BaselinePlannedSchema>
