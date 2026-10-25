import { z } from 'zod'

/** One of the makers products are sold under. */
export const BrandSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const BrandCreateSchema = BrandSchema.pick({ name: true })

export type BrandDTO = z.infer<typeof BrandSchema>
export type BrandCreateDTO = z.input<typeof BrandCreateSchema>
