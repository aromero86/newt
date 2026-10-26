import { message } from '../../../messages/message'
import { ValidationError } from '../../../errors/validation-error'

/** A token that is not one of the ones handed out; it never repeats what was sent. */
export class InvalidSecretToken extends ValidationError {
  readonly code = 'invalid_secret_token'
  constructor() {
    super(message('invalid_secret_token'))
  }
}
