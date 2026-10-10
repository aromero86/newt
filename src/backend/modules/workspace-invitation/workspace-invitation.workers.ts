import { WorkspaceInvitationEmail } from './value-objects/workspace-invitation-email'
import type { WorkspaceInvitation_Deps } from './workspace-invitation.deps'
import type { WorkspaceInvitation_Module } from './workspace-invitation.module'

export function registerWorkspaceInvitationWorkers(invitations: WorkspaceInvitation_Module, deps: WorkspaceInvitation_Deps) {
  // The email leaves after the invitation committed, outside its transaction.
  invitations.created.subscribe(invitation => deps.mail.send(WorkspaceInvitationEmail.from({ invitation, publicUrl: invitations.options.publicUrl })))

  // Signing up with an invited email is accepting the invitation.
  deps.user.created.subscribe(user => invitations.acceptFor(user))
}
