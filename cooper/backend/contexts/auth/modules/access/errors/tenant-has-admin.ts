import { ConflictError } from 'newt-kit/core'

/** A workspace has one admin, who made it: a second one is refused, however it came. */
export class TenantHasAdmin extends ConflictError {
  readonly code = 'access.tenant_has_admin'
  constructor(tenantId: string) {
    super(`The workspace ${tenantId} has an admin already`)
  }
}
