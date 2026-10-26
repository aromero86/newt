import { NotFoundError } from 'newt/core'

export class AuthorizationNotFound extends NotFoundError {
  readonly code = 'oauthGrant.not_found'
  constructor(id: string) {
    super(`There is no authorization request ${id}`)
  }
}
