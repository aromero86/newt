import { ConflictError } from '../../../core/errors/conflict-error'

export class NothingToRelease extends ConflictError {
  readonly code = 'release.nothing_to_release'
  constructor() {
    super('Nothing changed since the last release: there is nothing to publish')
  }
}
