import { currentActor } from 'newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/initialize-modules'
import { InvitationNotOpen } from '../../../auth/modules/invitation/errors/invitation-not-open'
import type { InvitationCreateDTO } from '../../../auth/modules/invitation/invitation.schema'
import type { TenantCreateDTO, TenantRenameDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Workspace_Deps } from './workspace.deps'
import { everything, type Workspace_Module } from './workspace.module'
import { workspaceInvitationOf, workspaceOf, type InvitationReviewDTO } from './workspace.schema'

const noContent = () => new Response(null, { status: 204 })

export function registerWorkspaceRoutes(base: BoardsBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)
  const { tenant, access, invitation } = deps.auth

  workspace.get('/boards/:boardId/view', async request => Response.json(await workspaces.boardView(request.params.boardId)))

  // Workspaces, their members and their invitations are auth's. boards' UI manages them
  // through boards' own origin, and these routes call auth's use cases directly: each
  // route is an adapter, an entry point like any client's, and what it writes starts
  // in auth, under auth's own rules (who is admin, the single admin, the write rule).
  // No use case of boards writes in auth: boards only reads it (`mine`, `members`), and
  // hears what auth did through its events, from a worker (a new workspace's board).

  base.http.get('/workspaces', async () => Response.json(await workspaces.mine()))

  base.http.post('/workspaces', async request => {
    const created = await tenant.create(await request.json() as TenantCreateDTO)
    return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
  })

  // The rest is about one workspace: a member's (404 for anyone else), and auth checks the admin.
  workspace.patch('', async request => {
    const renamed = await tenant.rename(request.params.workspaceId, await request.json() as TenantRenameDTO)
    return Response.json(workspaceOf(renamed, currentActor().userId))
  })

  workspace.delete('', async request => {
    await tenant.delete(request.params.workspaceId)
    return noContent()
  })

  workspace.get('/members', async () => Response.json(await workspaces.members()))

  // Its admin removes someone, or a member leaves: their cards are unassigned a moment later.
  workspace.delete('/members/:userId', async request => {
    await access.revoke({ userId: request.params.userId, productId: WORKSPACES_PRODUCT, tenantId: request.params.workspaceId })
    return noContent()
  })

  workspace.get('/invitations', async request => {
    const pending = await everything(page => invitation.list(request.params.workspaceId, page))
    return Response.json(pending.map(workspaceInvitationOf))
  })

  workspace.post('/invitations', async request => {
    const created = await invitation.create(request.params.workspaceId, await request.json() as InvitationCreateDTO)
    return Response.json(workspaceInvitationOf(created), { status: 201 })
  })

  workspace.delete('/invitations/:invitationId', async request => {
    await invitation.revoke(request.params.invitationId)
    return noContent()
  })

  // An invitation's link, before signing in: what it is for. One that opens nothing says so.
  base.http.get('/invitations/:token', async request => {
    const review = await invitation.review(request.params.token)
    if (!review.open) throw new InvitationNotOpen()
    const answer: InvitationReviewDTO = { workspaceName: review.tenantName, email: review.email, invitedBy: review.invitedByName }
    return Response.json(answer)
  }, { public: true })

  // Signed in with the invited email: the person joins the workspace.
  base.http.post('/invitations/:token/accept', async request => {
    const accepted = await invitation.accept(request.params.token)
    return Response.json({ workspaceId: accepted.tenantId })
  })
}
