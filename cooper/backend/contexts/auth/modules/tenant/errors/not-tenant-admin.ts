import { ForbiddenError } from '@newt-kit/newt/core'

/** A member who is not the workspace's admin, trying what only the admin may do. */
export class NotTenantAdmin extends ForbiddenError {
  readonly code = 'tenant.not_admin'
  constructor() {
    super('Only the admin of the workspace may do this')
  }
}
