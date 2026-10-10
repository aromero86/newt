import type { Base } from '../../base/base'
import { pageRequestFrom } from '../../base/http/page-request-from'
import type { WorkspaceCreateDTO, WorkspaceUpdateDTO } from './workspace'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: Base, workspaces: Workspace_Module) {
  // The use cases check who may do what and validate every body.
  base.http.get('/workspaces', async request => Response.json(await workspaces.mine(pageRequestFrom(request))))

  base.http.post('/workspaces', async request => Response.json(await workspaces.create((await request.json()) as WorkspaceCreateDTO), { status: 201 }))

  base.http.get('/workspaces/:workspaceId', async request => Response.json(await workspaces.get(request.params.workspaceId!)))

  base.http.patch('/workspaces/:workspaceId', async request =>
    Response.json(await workspaces.update(request.params.workspaceId!, (await request.json()) as WorkspaceUpdateDTO)))

  base.http.post('/workspaces/:workspaceId/archive', async request => Response.json(await workspaces.archive(request.params.workspaceId!)))

  base.http.post('/workspaces/:workspaceId/unarchive', async request => Response.json(await workspaces.unarchive(request.params.workspaceId!)))
}
