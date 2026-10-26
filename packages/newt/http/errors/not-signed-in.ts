import { UnauthorizedError } from '../../core'
import { message } from '../../core/internal'

export class NotSignedIn extends UnauthorizedError {
  readonly code = 'not_signed_in'
  constructor() {
    super(message('not_signed_in'))
  }
}
