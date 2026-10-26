import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The whole board as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

export class Board_Updated implements DomainEvent<BoardChange> {
  static readonly eventName = 'board.updated'
  readonly name = Board_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardChange) {}
}
