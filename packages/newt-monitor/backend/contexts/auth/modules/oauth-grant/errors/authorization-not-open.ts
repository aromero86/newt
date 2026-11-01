import { ConflictError } from '@newt-kit/newt/core'

/** Answered already, or waited too long: the application has to ask again. */
export class AuthorizationNotOpen extends ConflictError {
  readonly code = 'oauthGrant.not_open'
  constructor() {
    super('This request was answered already or has expired: go back to the application and try again')
  }
}
