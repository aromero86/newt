import { ValidationError } from 'newt/core'

/** A client secret too short to be one: cooper's own are configured, never typed. */
export class InvalidClientSecret extends ValidationError {
  readonly code = 'oauthClient.invalid_secret'
  constructor() {
    super('A client secret has at least 24 characters')
  }
}
