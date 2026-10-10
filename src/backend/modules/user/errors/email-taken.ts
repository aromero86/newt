import { ConflictError } from '../../../core/errors/conflict-error'

export class EmailTaken extends ConflictError {
  readonly code = 'user.email_taken'
  constructor() {
    super('There is already an account with this email')
  }
}
