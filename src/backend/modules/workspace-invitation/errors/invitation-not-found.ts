import { NotFoundError } from '../../../core/errors/not-found-error'

export class InvitationNotFound extends NotFoundError {
  readonly code = 'workspaceInvitation.not_found'
  constructor(id: string) {
    super(`Invitation ${id} not found`)
  }
}
