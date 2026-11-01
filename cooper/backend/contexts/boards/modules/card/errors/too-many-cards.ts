import { ConflictError } from 'newt-kit/core'
import { MAX_CARDS } from '../card.schema'

export class TooManyCards extends ConflictError {
  readonly code = 'card.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_CARDS} cards already: that is the most a board holds`)
  }
}
