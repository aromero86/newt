import type { DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** An invitation no longer opens its workspace: its admin took it back, or the workspace is gone. */
export class Invitation_Revoked implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.revoked'
  readonly name = Invitation_Revoked.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
