import { NotFoundError } from 'newt-kit/core'

/** No invitation has this id, or this link: one answer for both. */
export class InvitationNotFound extends NotFoundError {
  readonly code = 'invitation.not_found'
  constructor() {
    super('There is no such invitation')
  }
}
