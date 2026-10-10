import { ConflictError } from '../../../core/errors/conflict-error'

export class NickTaken extends ConflictError {
  readonly code = 'user.nick_taken'
  constructor(nick: string) {
    super(`The nick @${nick} is already taken`)
  }
}
