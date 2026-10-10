import { ValidationError } from '../../../errors/validation-error'

export class InvalidEmail extends ValidationError {
  readonly code = 'invalid_email'
  constructor(email: string) {
    super(`'${email}' is not a valid email`)
  }
}
