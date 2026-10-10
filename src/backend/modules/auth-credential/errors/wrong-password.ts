import { ValidationError } from '../../../core/errors/validation-error'

export class WrongPassword extends ValidationError {
  readonly code = 'authCredential.wrong_password'
  constructor() {
    super('The current password is not right')
  }
}
