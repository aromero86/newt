import type { DomainEvent } from 'newt/core'
import type { AccessDTO } from '../access.schema'

/** Someone may no longer enter a product (or one of its tenants): the access as it was. */
export class Access_Revoked implements DomainEvent<AccessDTO> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: AccessDTO) {}
}
