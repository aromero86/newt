import { ValidationError } from '../../core'
import { message } from '../../core/internal'

/** A request whose body cannot be read as what the route asks for (JSON or a form that is not). */
export class MalformedBody extends ValidationError {
  readonly code = 'malformed_body'
  constructor(cause?: Error) {
    super(message('malformed_body'))
    this.cause = cause
  }
}
