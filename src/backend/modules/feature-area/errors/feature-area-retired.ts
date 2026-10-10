import { ConflictError } from '../../../core/errors/conflict-error'

export class FeatureAreaRetired extends ConflictError {
  readonly code = 'featureArea.retired'
  constructor() {
    super('This area is retired: restore it to change it')
  }
}
