import { ConflictError } from '../../../core/errors/conflict-error'

export class DimensionLimitReached extends ConflictError {
  readonly code = 'dimension.limit_reached'
  constructor(what: 'dimensions' | 'values', limit: number) {
    super(what === 'dimensions' ? `A workspace has at most ${limit} dimensions` : `A dimension has at most ${limit} values`)
  }
}
