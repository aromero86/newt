import { ValidationError } from '@newt-kit/newt/core'

/** Unknown, expired, used or another client's refresh token: one answer for all (RFC 6749's `invalid_grant`). */
export class InvalidRefreshToken extends ValidationError {
  readonly code = 'token.invalid_grant'
  constructor() {
    super('The refresh token is not valid any more: sign in again')
  }
}
