import { ConflictError } from '@newt-kit/newt/core'

/** Accepted, revoked or expired: it opens nothing any more. */
export class InvitationNotOpen extends ConflictError {
  readonly code = 'invitation.not_open'
  constructor() {
    super('This invitation was accepted, revoked or has expired: ask for a new one')
  }
}
