import { ConflictError } from '../../../core/errors/conflict-error'

export class FeatureNameTaken extends ConflictError {
  readonly code = 'feature.name_taken'
  constructor(name: string, retired: boolean) {
    super(retired ? `${name} is a retired feature of this area: restore it instead` : `This area already has a feature called ${name}`)
  }
}
