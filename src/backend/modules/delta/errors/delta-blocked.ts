import { ConflictError } from '../../../core/errors/conflict-error'

export class DeltaBlocked extends ConflictError {
  readonly code = 'delta.blocked'
  constructor(blockers: string[]) {
    super(`Some deltas cannot go ahead yet: ${blockers.join('; ')}`)
  }
}
