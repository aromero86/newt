import { z } from 'zod'
import { BoardName } from './value-objects/board-name'

export const BoardSchema = z.object({
  id: z.uuidv7(),
  /** The workspace it is in: an auth tenant, by id. */
  workspaceId: z.string(),
  /** Its workspace's once, whatever its case. */
  name: BoardName.schema,
  description: z.string().max(500),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** As someone types it: the name is made a `BoardName` by the board itself. */
export const BoardCreateSchema = z.object({
  name: z.string(),
  description: z.string().trim().pipe(BoardSchema.shape.description).default(''),
})
export const BoardUpdateSchema = z.object({
  name: BoardCreateSchema.shape.name,
  description: z.string().trim().pipe(BoardSchema.shape.description),
}).partial()

export type BoardDTO = z.infer<typeof BoardSchema>
export type BoardCreateDTO = z.input<typeof BoardCreateSchema>
export type BoardUpdateDTO = z.input<typeof BoardUpdateSchema>
