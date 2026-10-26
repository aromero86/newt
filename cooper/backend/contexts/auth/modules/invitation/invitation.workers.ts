import type { Invitation_Deps } from './invitation.deps'
import type { Invitation_Module } from './invitation.module'

/**
 * An invitation's email leaves once it is saved, from a job: an email cannot be taken
 * back, so it never leaves for an invitation that rolled back. And a deleted
 * workspace's invitations stop opening it.
 */
export function registerInvitationWorkers(invitations: Invitation_Module, deps: Invitation_Deps): void {
  invitations.events.created.subscribe(invitation => invitations.send(invitation.id), {
    strategy: 'handler',
    queue: 'invitation.send.on.invitation.created',
  })
  deps.tenant.events.deleted.subscribe(tenant => invitations.revokeForTenant(tenant.id), {
    strategy: 'handler',
    queue: 'invitation.revokeForTenant.on.tenant.deleted',
  })
}
