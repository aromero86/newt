import { message } from '../messages/message'
import { ValidationError } from './validation-error'

export class ReferenceNotFound extends ValidationError {
  readonly code = 'reference_not_found'
  constructor(resource: string, id: string) {
    super(message('reference_not_found', { resource, id }))
  }
}
