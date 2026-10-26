import { now, type DomainEvent } from 'newt/core'
import type { ColumnDTO } from '../column.schema'

/** The column as it is now, and the name it had (`previous`). */
type ColumnRename = { dto: ColumnDTO, changes: Partial<ColumnDTO>, previous: Partial<ColumnDTO> }

export class Column_Renamed implements DomainEvent<ColumnRename> {
  static readonly eventName = 'column.renamed'
  readonly name = Column_Renamed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ColumnRename) {}
}
