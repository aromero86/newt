import { ValidationError } from 'newt-kit/core'

/** A card goes only to a column of its own board: the request named another. */
export class ColumnNotInBoard extends ValidationError {
  readonly code = 'card.column_not_in_board'
  constructor(columnId: string, boardId: string) {
    super(`Column ${columnId} is not a column of board ${boardId}`)
  }
}
