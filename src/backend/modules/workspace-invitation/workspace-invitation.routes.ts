import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { WorkspaceInvitationCreateDTO } from './workspace-invitation.schema'
import type { WorkspaceInvitation_Module } from './workspace-invitation.module'

export function registerWorkspaceInvitationRoutes(base: Base, invitations: WorkspaceInvitation_Module) {
  // The use cases check who may do what and validate every body.
  base.http.get('/workspaces/:workspaceId/invitations', async request => Response.json(await invitations.pending(request.params.workspaceId!, pageRequestFrom(request))))

  base.http.post('/workspaces/:workspaceId/invitations', async request =>
    Response.json(await invitations.invite(request.params.workspaceId!, (await request.json()) as WorkspaceInvitationCreateDTO), { status: 201 }))

  base.http.delete('/workspaces/:workspaceId/invitations/:invitationId', async request => {
    const { workspaceId, invitationId } = request.params as { workspaceId: string, invitationId: string }
    await invitations.cancel(workspaceId, invitationId)
    return new Response(null, { status: 204 })
  })
}
