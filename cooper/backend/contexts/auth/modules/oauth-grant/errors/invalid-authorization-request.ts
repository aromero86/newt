import { ValidationError } from 'newt-kit/core'

/**
 * A client asked for access the wrong way. The person is shown why, and the browser
 * never goes back to an address nobody vouched for.
 */
export class InvalidAuthorizationRequest extends ValidationError {
  readonly code = 'oauthGrant.invalid_request'
  constructor(reason: string) {
    super(reason)
  }
}
