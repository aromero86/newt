import { ConflictError } from '../../../core/errors/conflict-error'

export class ReleaseNameTaken extends ConflictError {
  readonly code = 'release.name_taken'
  constructor(name: string) {
    super(`This workspace already has a release called ${name}`)
  }
}
