import { ConflictError } from '@newt-kit/newt/core'

/** This email has an invitation waiting already, or is a member. */
export class AlreadyInvited extends ConflictError {
  readonly code = 'invitation.already_invited'
  constructor(email: string) {
    super(`${email} is a member of this workspace or has an invitation waiting`)
  }
}
