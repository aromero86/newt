import { ValidationError } from '../../../core/errors/validation-error'

export class InvalidDelta extends ValidationError {
  readonly code = 'delta.invalid'
  constructor(reason: string) {
    super(reason)
  }
}
