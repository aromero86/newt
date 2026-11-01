import { now, type DomainEvent } from '@newt-kit/newt/core'
import type { ColumnDTO } from '../column.schema'

export class Column_Added implements DomainEvent<ColumnDTO> {
  static readonly eventName = 'column.added'
  readonly name = Column_Added.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnDTO) {}
}
