import { NotFoundError } from '../../../core/errors/not-found-error'

export class FeatureNotFound extends NotFoundError {
  readonly code = 'feature.not_found'
  constructor(id: string) {
    super(`Feature ${id} not found`)
  }
}
