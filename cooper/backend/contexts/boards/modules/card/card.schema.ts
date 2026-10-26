import { defineFilter } from 'newt/core'
import { z } from 'zod'
import type { ActorVia } from '../../../../shared/actor'

/** The most cards a board holds: a board is read whole, as one screen. */
export const MAX_CARDS = 500

/** A card of a board: something to do, in the column of its status. */
export const CardSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  /** Its status: the column it is in, by id. The column is another module's. */
  columnId: z.string(),
  /** #1, #2…: its board's, in the order its cards were created, never reused. */
  number: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  /** Who it is assigned to: a member of the workspace, by their user's id in auth. */
  assigneeId: z.string().nullable(),
  /** Where it is in its column, from 0 at the top: a column's cards are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

const description = z.string().trim().pipe(CardSchema.shape.description)

export const CardCreateSchema = CardSchema.pick({ columnId: true, title: true }).extend({
  description: description.default(''),
  assigneeId: CardSchema.shape.assigneeId.default(null),
})
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
/** Where it goes: a column of its board and, in it, a position; at the bottom when none is given, or one past it. */
export const CardMoveSchema = z.object({
  columnId: CardSchema.shape.columnId,
  position: CardSchema.shape.position.optional(),
})
export const CardAssignSchema = z.object({ assigneeId: z.string() })

/** What a client may search cards by: these fields, these operators, nothing else. */
export const CardFilter = defineFilter({
  board: { field: 'boardId', value: z.string(), ops: ['eq', 'in'] },
  column: { field: 'columnId', value: z.string(), ops: ['eq', 'in'] },
  assignee: { field: 'assigneeId', value: z.string(), ops: ['eq', 'in'] },
  number: { field: 'number', value: z.number().int(), ops: ['eq'] },
}, { maxDepth: 2, maxConditions: 10 })

/** A search: words its title or description has (whatever their case), and a filter on the fields above. */
export const CardSearchSchema = z.object({
  text: z.string().trim().max(100).optional(),
  filter: CardFilter.schema.optional(),
})

export type CardDTO = z.infer<typeof CardSchema>
export type CardCreateDTO = z.input<typeof CardCreateSchema>
export type CardEditDTO = z.input<typeof CardEditSchema>
export type CardMoveDTO = z.input<typeof CardMoveSchema>
export type CardAssignDTO = z.input<typeof CardAssignSchema>
/** A filter as a client sends it: groups of conditions on the fields of `CardFilter`. */
export type CardFilterDTO = z.infer<typeof CardFilter.schema>
export type CardSearchDTO = z.input<typeof CardSearchSchema>

/** How many cards a workspace has, for whoever looks at many (the staff's backoffice). */
export type CardCountByWorkspace = { workspaceId: string, cards: number }
/** How many cards a board has. */
export type CardCountByBoard = { boardId: string, cards: number }

/**
 * Who does something to a card, as its events tell it: their user's id (`by`) and how
 * they came in (`via`, the web or MCP). Both null for boards' own work, which a worker
 * does with no one behind it: a workspace's welcome card, the cards a
 * removed column or a member who left leaves behind.
 */
export type CardAuthor = { by: string | null, via: ActorVia | null }
