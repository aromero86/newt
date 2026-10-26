import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: BoardsBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/view', async request => Response.json(await workspaces.boardView(request.params.boardId)))
}
