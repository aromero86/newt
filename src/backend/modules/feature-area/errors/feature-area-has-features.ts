import { ConflictError } from '../../../core/errors/conflict-error'

export class FeatureAreaHasFeatures extends ConflictError {
  readonly code = 'featureArea.has_features'
  constructor(count: number) {
    super(`This area still has ${count === 1 ? '1 active feature' : `${count} active features`}: retire them first`)
  }
}
