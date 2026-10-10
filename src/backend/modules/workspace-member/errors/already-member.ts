import { ConflictError } from '../../../core/errors/conflict-error'

export class AlreadyMember extends ConflictError {
  readonly code = 'workspaceMember.already_member'
  constructor(nick: string) {
    super(`@${nick} is already a member`)
  }
}
