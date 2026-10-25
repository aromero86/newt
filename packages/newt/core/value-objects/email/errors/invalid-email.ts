import { message } from '../../../messages/message'
import { ValidationError } from '../../../errors/validation-error'

export class InvalidEmail extends ValidationError {
  readonly code = 'invalid_email'
  constructor(email: string) {
    super(message('invalid_email', { email }))
  }
}
