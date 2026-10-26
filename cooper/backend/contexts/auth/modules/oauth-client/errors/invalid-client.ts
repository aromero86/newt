import { UnauthorizedError } from 'newt/core'

/** Unknown, or with the wrong secret: one answer for all (RFC 6749's `invalid_client`). */
export class InvalidClient extends UnauthorizedError {
  readonly code = 'oauthClient.invalid_client'
  constructor() {
    super('The client is unknown, or did not prove it is who it says')
  }
}
