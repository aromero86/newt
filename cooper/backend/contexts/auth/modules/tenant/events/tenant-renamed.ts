import { now, type DomainEvent } from 'newt-kit/core'
import type { TenantDTO } from '../tenant.schema'

/** The whole workspace as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type TenantChange = { dto: TenantDTO, changes: Partial<TenantDTO>, previous: Partial<TenantDTO> }

export class Tenant_Renamed implements DomainEvent<TenantChange> {
  static readonly eventName = 'tenant.renamed'
  readonly name = Tenant_Renamed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantChange) {}
}
