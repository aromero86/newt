import { ConflictError } from '../../../core/errors/conflict-error'

export class FeatureAreaNameTaken extends ConflictError {
  readonly code = 'featureArea.name_taken'
  constructor(name: string, retired: boolean) {
    super(retired ? `${name} is a retired area of this workspace: restore it instead` : `This workspace already has an area called ${name}`)
  }
}
