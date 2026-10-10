import { ValidationError } from '../../../core/errors/validation-error'

export class WrongPassword extends ValidationError {
  readonly code = 'credential.wrong_password'
  constructor() {
    super('The current password is not right')
  }
}
