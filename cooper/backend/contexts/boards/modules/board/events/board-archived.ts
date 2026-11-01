import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { BoardDTO } from '../board.schema'

/** The board as it was when it was archived: it is kept, out of every list. */
export class Board_Archived implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.archived'
  readonly name = Board_Archived.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
