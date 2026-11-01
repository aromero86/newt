import { ForbiddenError } from 'newt-kit/core'

/** A product that lets in only whom it was told, and the person was not. */
export class NoProductAccess extends ForbiddenError {
  readonly code = 'oauthGrant.no_access'
  constructor(productName: string) {
    super(`You have no access to ${productName}: ask someone who runs it`)
  }
}
