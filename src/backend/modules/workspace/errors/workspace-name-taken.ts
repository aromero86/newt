import { ConflictError } from '../../../core/errors/conflict-error'

export class WorkspaceNameTaken extends ConflictError {
  readonly code = 'workspace.name_taken'
  constructor(name: string) {
    super(`You already have a workspace called ${name}`)
  }
}
