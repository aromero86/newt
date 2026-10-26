import type { DomainEvent } from 'newt/core'
import type { TenantDTO } from '../tenant.schema'

/**
 * A workspace was deleted: the start of a saga. auth takes every access to it away
 * and revokes its invitations; boards deletes its boards. Each from a worker.
 */
export class Tenant_Deleted implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: TenantDTO) {}
}
