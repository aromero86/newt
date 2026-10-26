import type { DomainEvent } from 'newt/core'
import type { AccessDTO } from '../access.schema'

/** Someone may now enter a product, for a tenant or for all of it. */
export class Access_Granted implements DomainEvent<AccessDTO> {
  static readonly eventName = 'access.granted'
  readonly name = Access_Granted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: AccessDTO) {}
}
