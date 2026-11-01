import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { ColumnDTO } from '../column.schema'

/** The column as it was when it was removed. */
export class Column_Removed implements DomainEvent<ColumnDTO> {
  static readonly eventName = 'column.removed'
  readonly name = Column_Removed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnDTO) {}
}
