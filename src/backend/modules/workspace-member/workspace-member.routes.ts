import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { WorkspaceMember_Module } from './workspace-member.module'
import type { WorkspaceMemberAddDTO, WorkspaceMemberRoleChangeDTO } from './workspace-member.schema'

export function registerWorkspaceMemberRoutes(base: Base, members: WorkspaceMember_Module) {
  // The use cases check who may do what and validate every body.
  base.http.get('/workspaces/:workspaceId/members', async request => Response.json(await members.list(request.params.workspaceId!, pageRequestFrom(request))))

  base.http.post('/workspaces/:workspaceId/members', async request => {
    await members.add(request.params.workspaceId!, (await request.json()) as WorkspaceMemberAddDTO)
    return new Response(null, { status: 204 })
  })

  // `me` is the signed-in person leaving; any other id is an admin taking someone out.
  base.http.delete('/workspaces/:workspaceId/members/:userId', async request => {
    const { workspaceId, userId } = request.params as { workspaceId: string, userId: string }
    await (userId === 'me' ? members.leave(workspaceId) : members.remove(workspaceId, userId))
    return new Response(null, { status: 204 })
  })

  base.http.patch('/workspaces/:workspaceId/members/:userId', async request => {
    const { workspaceId, userId } = request.params as { workspaceId: string, userId: string }
    await members.changeRole(workspaceId, userId, (await request.json()) as WorkspaceMemberRoleChangeDTO)
    return new Response(null, { status: 204 })
  })
}
