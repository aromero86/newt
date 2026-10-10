import { NotFoundError } from '../../../core/errors/not-found-error'

/** Also what someone outside the workspace gets: a private workspace does not exist for them. */
export class WorkspaceNotFound extends NotFoundError {
  readonly code = 'workspace.not_found'
  constructor(id: string) {
    super(`Workspace ${id} not found`)
  }
}
