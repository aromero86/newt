import type { DomainEvent } from '../../../core/events/domain-event'
import type { WorkspaceInvitationCreatedPayload } from '../workspace-invitation.schema'

export class WorkspaceInvitation_Created implements DomainEvent<WorkspaceInvitationCreatedPayload> {
  static readonly eventName = 'workspaceInvitation.created'
  readonly name = WorkspaceInvitation_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: WorkspaceInvitationCreatedPayload) {}
}
