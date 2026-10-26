import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The board as it was when it was archived: it is kept, out of every list. */
export class Board_Archived implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.archived'
  readonly name = Board_Archived.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
