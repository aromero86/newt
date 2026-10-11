import { NotFoundError } from '../../../core/errors/not-found-error'

export class ReleaseNotFound extends NotFoundError {
  readonly code = 'release.not_found'
  constructor(name: string) {
    super(`Release ${name} not found`)
  }
}
