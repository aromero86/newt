import { NotFoundError } from '@newt-kit/newt/core'

/** Whoever is not a member of a workspace is told it does not exist: a private thing never says it does. */
export class NotAMember extends NotFoundError {
  readonly code = 'access.not_a_member'
  constructor(tenantId: string) {
    super(`There is no workspace ${tenantId}`)
  }
}
