import { ConflictError } from '../../../core/errors/conflict-error'

export class DeltasNotApproved extends ConflictError {
  readonly code = 'delta.not_approved'
  constructor(count: number) {
    super(count === 0 ? 'A proposal needs at least one delta' : `${count === 1 ? '1 delta is' : `${count} deltas are`} not approved yet`)
  }
}
