import { ForbiddenError } from '@newt-kit/newt/core'

/** The link reached someone signed in with another email than the one invited. */
export class InvitationForAnotherEmail extends ForbiddenError {
  readonly code = 'invitation.another_email'
  constructor(email: string) {
    super(`This invitation is for ${email}: sign in with that email to accept it`)
  }
}
