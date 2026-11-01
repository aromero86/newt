import { ValidationError } from '@newt-kit/newt/core'
import { AUTHORIZATION_REQUEST_PROBLEMS, type AuthorizationRequestProblem } from '../oauth-grant.schema'

/**
 * A client asked for access the wrong way. The person is shown why, by its code, and
 * the browser never goes back to an address nobody vouched for.
 */
export class InvalidAuthorizationRequest extends ValidationError {
  constructor(readonly code: AuthorizationRequestProblem) {
    super(AUTHORIZATION_REQUEST_PROBLEMS[code])
  }
}
