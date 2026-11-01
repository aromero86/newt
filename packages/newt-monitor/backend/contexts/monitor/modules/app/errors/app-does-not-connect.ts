import { ValidationError } from 'newt-kit/core'
import type { AppCallFailure } from '../../../../../shared/app-client/app-call-failed'

/**
 * An address and a key that do not reach a monitor endpoint: nothing is saved. Its
 * code says why: `app.unreachable`, `app.key_rejected` or `app.bad_answer`.
 */
export class AppDoesNotConnect extends ValidationError {
  readonly code: string
  constructor(reason: Exclude<AppCallFailure, 'key_unreadable'>, message: string) {
    super(message)
    this.code = `app.${reason}`
  }
}
