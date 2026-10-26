import { now, type DomainEvent } from 'newt/core'
import type { TenantDTO } from '../tenant.schema'

/** A new workspace: boards gives it a first board from this. */
export class Tenant_Created implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.created'
  readonly name = Tenant_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantDTO) {}
}
