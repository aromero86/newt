import { ForbiddenError } from '../../../core/errors/forbidden-error'

export class NotWorkspaceAdmin extends ForbiddenError {
  readonly code = 'workspaceMember.not_admin'
  constructor() {
    super('Only an admin of this workspace can do this')
  }
}
