import { message } from '../../messages/message'
import { UnauthorizedError } from '../../errors/unauthorized-error'

export class NoActor extends UnauthorizedError {
  readonly code = 'not_signed_in'
  constructor() {
    super(message('not_signed_in'))
  }
}
