import { now, type DomainEvent } from 'newt-kit/core'
import type { StructureChangedDTO } from '../structure.schema'

export class Structure_Changed implements DomainEvent<StructureChangedDTO> {
  static readonly eventName = 'structure.changed'
  readonly name = Structure_Changed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: StructureChangedDTO) {}
}
