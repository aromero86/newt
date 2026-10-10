import { NotFoundError } from '../../../core/errors/not-found-error'

export class MemberNotFound extends NotFoundError {
  readonly code = 'workspaceMember.not_found'
  constructor(userId: string) {
    super(`User ${userId} is not a member of this workspace`)
  }
}
