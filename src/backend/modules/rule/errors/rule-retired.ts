import { ConflictError } from '../../../core/errors/conflict-error'

export class RuleRetired extends ConflictError {
  readonly code = 'rule.retired'
  constructor(key: string) {
    super(`${key} is retired: it can no longer change`)
  }
}
