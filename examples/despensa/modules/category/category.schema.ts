import { z } from 'zod'

/** One of the families products are grouped in. */
export const CategorySchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const CategoryCreateSchema = CategorySchema.pick({ name: true })

export type CategoryDTO = z.infer<typeof CategorySchema>
export type CategoryCreateDTO = z.input<typeof CategoryCreateSchema>
