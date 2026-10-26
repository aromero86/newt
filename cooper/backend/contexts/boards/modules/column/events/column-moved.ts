import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

/**
 * The column someone moved, where it is now and where it was (`previous`). The
 * columns it pushed aside tell nothing: they only took the places left.
 */
type ColumnMove = { dto: ColumnDTO, changes: Partial<ColumnDTO>, previous: Partial<ColumnDTO> }

export class Column_Moved implements DomainEvent<ColumnMove> {
  static readonly eventName = 'column.moved'
  readonly name = Column_Moved.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnMove) {}
}
