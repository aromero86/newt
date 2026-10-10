import { ConflictError } from '../../../core/errors/conflict-error'

export class WorkspaceArchived extends ConflictError {
  readonly code = 'workspace.archived'
  constructor() {
    super('This workspace is archived: unarchive it to change it')
  }
}
