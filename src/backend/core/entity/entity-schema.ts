import { z } from 'zod'

export type EntitySchema = z.ZodObject<z.ZodRawShape & { id: z.ZodType<string>, createdAt: z.ZodType<string>, updatedAt: z.ZodType<string> }>
