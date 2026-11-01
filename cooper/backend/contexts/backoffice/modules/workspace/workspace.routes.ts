import { pageRequestFrom } from 'newt-kit/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: CooperBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?name=acme`: a workspace's name, whole.
  routes.get('/workspaces', async request => {
    const name = new URL(request.url).searchParams.get('name') || undefined
    return Response.json(await workspaces.list({ name }, pageRequestFrom(request)))
  })

  // The latest boards of every workspace: a path of its own, before any workspace's id.
  routes.get('/workspaces/recent-boards', async () => Response.json(await workspaces.recentBoards()))

  routes.get('/workspaces/:workspaceId', async request => Response.json(await workspaces.get(request.params.workspaceId)))

  routes.get('/workspaces/:workspaceId/members', async request =>
    Response.json(await workspaces.members(request.params.workspaceId, pageRequestFrom(request))))

  routes.get('/workspaces/:workspaceId/boards', async request =>
    Response.json(await workspaces.boards(request.params.workspaceId, pageRequestFrom(request))))
}
