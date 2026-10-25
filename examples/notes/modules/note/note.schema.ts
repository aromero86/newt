import { z } from 'zod'

export const NoteSchema = z.object({
  id: z.uuidv7(),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(10_000),
  /** Who wrote it: the actor of the request that made it. */
  authorId: z.string(),
  archived: z.boolean(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const NoteCreateSchema = NoteSchema.pick({ title: true }).extend({ body: NoteSchema.shape.body.default('') })
export const NoteUpdateSchema = NoteSchema.pick({ title: true, body: true, archived: true }).partial()
export const NoteFiltersSchema = z.object({ archived: z.boolean().optional() })

export type NoteDTO = z.infer<typeof NoteSchema>
export type NoteCreateDTO = z.input<typeof NoteCreateSchema>
export type NoteUpdateDTO = z.input<typeof NoteUpdateSchema>
export type NoteFiltersDTO = z.infer<typeof NoteFiltersSchema>
