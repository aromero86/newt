import { NotFoundError } from '../../../core/errors/not-found-error'

export class DimensionNotFound extends NotFoundError {
  readonly code = 'dimension.not_found'
  constructor(id: string) {
    super(`Dimension ${id} not found`)
  }
}
