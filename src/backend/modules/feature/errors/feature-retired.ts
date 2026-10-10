import { ConflictError } from '../../../core/errors/conflict-error'

export class FeatureRetired extends ConflictError {
  readonly code = 'feature.retired'
  constructor() {
    super('This feature is retired: restore it to change it')
  }
}
