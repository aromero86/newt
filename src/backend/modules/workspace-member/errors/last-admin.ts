import { ConflictError } from '../../../core/errors/conflict-error'

/** A workspace always keeps one active admin, so it is never left without an owner. */
export class LastAdmin extends ConflictError {
  readonly code = 'workspaceMember.last_admin'
  constructor() {
    super('A workspace needs at least one admin: name another admin first')
  }
}
