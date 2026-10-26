import { now, type DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** Someone accepted an invitation: they are a member of its workspace (`access.granted` says so too). */
export class Invitation_Accepted implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.accepted'
  readonly name = Invitation_Accepted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
