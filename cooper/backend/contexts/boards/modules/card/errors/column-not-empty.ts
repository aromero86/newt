import { ConflictError } from 'newt-kit/core'

/** A column is removed only once no card is in it. */
export class ColumnNotEmpty extends ConflictError {
  readonly code = 'card.column_not_empty'
  constructor(columnId: string, cards: number) {
    super(`Column ${columnId} has ${cards} card(s): move them to another column first`)
  }
}
