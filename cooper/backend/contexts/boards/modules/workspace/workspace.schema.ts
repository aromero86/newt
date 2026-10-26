import type { BoardDTO } from '../board/board.schema'
import type { CardDTO } from '../card/card.schema'
import type { ColumnDTO } from '../column/column.schema'

/** A board as its screen shows it: the board, its columns from left to right, and their cards from the top. */
export type BoardViewDTO = {
  board: BoardDTO
  columns: ColumnDTO[]
  cards: CardDTO[]
}

/** The board every new workspace starts with. */
export const WELCOME_BOARD = {
  name: 'Welcome',
  description: 'A first board to find your way around: move the card, add your own.',
  columns: ['To do', 'Doing', 'Done'],
  card: {
    title: 'Welcome to cooper',
    description: 'Drag this card to Doing, then to Done. Add columns and cards of your own, and assign them to the people of your workspace.',
  },
} as const
