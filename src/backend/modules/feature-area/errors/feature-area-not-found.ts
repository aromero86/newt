import { NotFoundError } from '../../../core/errors/not-found-error'

export class FeatureAreaNotFound extends NotFoundError {
  readonly code = 'featureArea.not_found'
  constructor(id: string) {
    super(`Area ${id} not found`)
  }
}
