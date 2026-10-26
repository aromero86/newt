import { NotFoundError } from 'newt/core'

/** A workspace the person does not belong to, or that does not exist: to them, the same thing. */
export class WorkspaceNotFound extends NotFoundError {
  readonly code = 'workspace.not_found'
  constructor(id: string) {
    super(`There is no workspace ${id}`)
  }
}
