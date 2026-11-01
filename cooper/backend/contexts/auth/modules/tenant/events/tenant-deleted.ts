import { now, type DomainEvent } from 'newt-kit/core'
import type { TenantDTO } from '../tenant.schema'

/**
 * A workspace was deleted: the start of a saga. auth revokes its invitations, and
 * takes every access to it away once more (`delete` already did, in the request);
 * boards deletes its boards. Each from a worker.
 */
export class Tenant_Deleted implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: TenantDTO) {}
}
