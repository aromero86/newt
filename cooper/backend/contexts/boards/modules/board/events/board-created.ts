import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { BoardDTO } from '../board.schema'

export class Board_Created implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.created'
  readonly name = Board_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
