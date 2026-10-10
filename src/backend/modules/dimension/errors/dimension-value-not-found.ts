import { NotFoundError } from '../../../core/errors/not-found-error'

export class DimensionValueNotFound extends NotFoundError {
  readonly code = 'dimension.value_not_found'
  constructor(id: string) {
    super(`Value ${id} not found`)
  }
}
