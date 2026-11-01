import { NotFoundError } from 'newt-kit/core'

export class TenantNotFound extends NotFoundError {
  readonly code = 'tenant.not_found'
  constructor(id: string) {
    super(`There is no workspace ${id}`)
  }
}
