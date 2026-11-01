import { now, type DomainEvent } from 'newt-kit/core'
import type { ConnectionChangedDTO } from '../connection.schema'

export class Connection_Restored implements DomainEvent<ConnectionChangedDTO> {
  static readonly eventName = 'connection.restored'
  readonly name = Connection_Restored.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ConnectionChangedDTO) {}
}
