import { ValidationError } from '../../../core/errors/validation-error'

export class InvalidRuleScope extends ValidationError {
  readonly code = 'rule.invalid_scope'
  constructor(reason: string) {
    super(`Invalid scope: ${reason}`)
  }
}
