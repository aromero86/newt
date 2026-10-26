import { z } from 'zod'

/**
 * An entity's schema: a `z.object` (or `z.strictObject`) with its id and timestamps.
 * One that keeps the fields it does not name (`z.looseObject`, `.catchall`) is refused
 * when the entity is built: a row's other columns would end up in it.
 */
export type EntitySchema = z.ZodObject<z.ZodRawShape & { id: z.ZodType<string>, createdAt: z.ZodType<string>, updatedAt: z.ZodType<string> }>
