import { ConflictError } from 'newt/core'
import { MAX_COLUMNS } from '../column.schema'

export class TooManyColumns extends ConflictError {
  readonly code = 'column.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_COLUMNS} columns already: that is the most a board has`)
  }
}
