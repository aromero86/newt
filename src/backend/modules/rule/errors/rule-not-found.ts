import { NotFoundError } from '../../../core/errors/not-found-error'

export class RuleNotFound extends NotFoundError {
  readonly code = 'rule.not_found'
  constructor(key: string) {
    super(`Rule ${key} not found`)
  }
}
