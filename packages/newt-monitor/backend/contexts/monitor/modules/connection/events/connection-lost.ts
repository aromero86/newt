import { now, type DomainEvent } from 'newt/core'
import type { ConnectionChangedDTO } from '../connection.schema'

export class Connection_Lost implements DomainEvent<ConnectionChangedDTO> {
  static readonly eventName = 'connection.lost'
  readonly name = Connection_Lost.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ConnectionChangedDTO) {}
}
