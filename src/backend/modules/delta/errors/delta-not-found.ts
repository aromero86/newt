import { NotFoundError } from '../../../core/errors/not-found-error'

export class DeltaNotFound extends NotFoundError {
  readonly code = 'delta.not_found'
  constructor(id: string) {
    super(`Delta ${id} not found`)
  }
}
