import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => Response.json(await columns.add(request.params.boardId, await request.json()), { status: 201 }))

  workspace.patch('/columns/:columnId', async request => Response.json(await columns.rename(request.params.columnId, await request.json())))
}
