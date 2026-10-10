import { z } from 'zod'

export const NoteModuleName = 'note'

export const NoteSchema = z.object({
  id: z.uuidv7(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10_000),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const CreateNoteSchema = NoteSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const UpdateNoteSchema = CreateNoteSchema.partial()

export type NoteDTO = z.infer<typeof NoteSchema>
export type CreateNoteDTO = z.infer<typeof CreateNoteSchema>
export type UpdateNoteDTO = z.infer<typeof UpdateNoteSchema>
