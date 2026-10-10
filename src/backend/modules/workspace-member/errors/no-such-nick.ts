import { ValidationError } from '../../../core/errors/validation-error'

export class NoSuchNick extends ValidationError {
  readonly code = 'workspaceMember.no_such_nick'
  constructor(nick: string) {
    super(`Nobody is called @${nick}. To add someone without an account, invite them by email`)
  }
}
