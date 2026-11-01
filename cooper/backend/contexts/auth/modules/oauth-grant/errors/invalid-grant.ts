import { ValidationError } from '@newt-kit/newt/core'

/** Unknown, used, expired or another client's code: one answer for all (RFC 6749's `invalid_grant`). */
export class InvalidGrant extends ValidationError {
  readonly code = 'oauthGrant.invalid_grant'
  constructor() {
    super('The code is not valid any more: start signing in again')
  }
}
