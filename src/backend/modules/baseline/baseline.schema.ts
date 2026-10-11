import { z } from 'zod'
import { DeltaSchema } from '../delta/delta.schema'

export const BaselineModuleName = 'baseline'

/** A change the planned definition has and the one in force does not yet: a delta of an accepted proposal. */
export const BaselinePlannedSchema = z.object({
  proposal: z.object({ id: z.uuidv7(), key: z.string(), title: z.string() }),
  delta: DeltaSchema,
})

export type BaselinePlannedDTO = z.infer<typeof BaselinePlannedSchema>
