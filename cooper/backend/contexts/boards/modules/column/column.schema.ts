import { z } from 'zod'

/** The most columns a board has. */
export const MAX_COLUMNS = 10

/** A board's column: a status its cards are in (To do, Doing, Done…). */
export const ColumnSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  /** The board it is in, by id: the board is another module's. */
  boardId: z.string(),
  name: z.string().trim().min(1).max(40),
  /** Where it is on its board, from 0 on the left: a board's columns are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const ColumnAddSchema = ColumnSchema.pick({ name: true })
export const ColumnRenameSchema = ColumnSchema.pick({ name: true })
/** Where it goes: a position past the last one is the last. */
export const ColumnMoveSchema = ColumnSchema.pick({ position: true })

export type ColumnDTO = z.infer<typeof ColumnSchema>
export type ColumnAddDTO = z.input<typeof ColumnAddSchema>
export type ColumnRenameDTO = z.input<typeof ColumnRenameSchema>
export type ColumnMoveDTO = z.input<typeof ColumnMoveSchema>
