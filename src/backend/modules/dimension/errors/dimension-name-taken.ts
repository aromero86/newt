import { ConflictError } from '../../../core/errors/conflict-error'

export class DimensionNameTaken extends ConflictError {
  readonly code = 'dimension.name_taken'
  constructor(name: string) {
    super(`This workspace already has a dimension called ${name}`)
  }
}
