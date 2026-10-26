import { now, type DomainEvent } from 'newt/core'
import type { InvitationDTO } from '../invitation.schema'

/** Someone was invited to a workspace: its email leaves from a worker, after this. */
export class Invitation_Created implements DomainEvent<InvitationDTO> {
  static readonly eventName = 'invitation.created'
  readonly name = Invitation_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvitationDTO) {}
}
