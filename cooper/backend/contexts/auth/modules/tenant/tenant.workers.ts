import type { Tenant_Module } from './tenant.module'

/**
 * What a workspace's own events set going, in auth. Both write to `access`, which only
 * a worker may do: a job runs again until it completes, so each one converges.
 */
export function registerTenantWorkers(tenants: Tenant_Module): void {
  // Its admin, in case the request that made it stopped before giving it.
  tenants.events.created.subscribe(tenant => tenants.ensureAdmin(tenant), {
    strategy: 'handler',
    queue: 'tenant.ensureAdmin.on.tenant.created',
  })
  // A step of its deletion: nobody enters it any more.
  tenants.events.deleted.subscribe(tenant => tenants.removeAccesses(tenant.id), {
    strategy: 'handler',
    queue: 'tenant.removeAccesses.on.tenant.deleted',
  })
}
