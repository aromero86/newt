import { ConflictError } from 'newt/core'

/** A board keeps one column at least: where its cards go when another column is removed. */
export class LastColumn extends ConflictError {
  readonly code = 'column.last'
  constructor(boardId: string) {
    super(`Board ${boardId} has only this column: a board keeps one at least`)
  }
}
