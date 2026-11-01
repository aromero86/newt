import { ConflictError } from '@newt-kit/newt/core'

/** A workspace keeps its admin for as long as it exists. */
export class AdminNotRevocable extends ConflictError {
  readonly code = 'access.admin_not_revocable'
  constructor() {
    super('The admin of a workspace cannot be removed from it')
  }
}
