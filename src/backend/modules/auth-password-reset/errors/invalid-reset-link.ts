import { ValidationError } from '../../../core/errors/validation-error'

/** Unknown, used, cancelled or expired: one answer for all, it reveals nothing. */
export class InvalidResetLink extends ValidationError {
  readonly code = 'authPasswordReset.invalid_link'
  constructor() {
    super('This link no longer works. Ask for a new one.')
  }
}
