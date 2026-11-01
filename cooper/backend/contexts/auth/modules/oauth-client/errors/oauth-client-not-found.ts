import { NotFoundError } from '@newt-kit/newt/core'

export class OauthClientNotFound extends NotFoundError {
  readonly code = 'oauthClient.not_found'
  constructor(clientId: string) {
    super(`There is no OAuth client ${clientId}`)
  }
}
