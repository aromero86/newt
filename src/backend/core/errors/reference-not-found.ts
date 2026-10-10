import { ValidationError } from './validation-error'

export class ReferenceNotFound extends ValidationError {
  readonly code = 'reference_not_found'
  constructor(resource: string, id: string) {
    super(`Referenced ${resource} ${id} not found`)
  }
}
