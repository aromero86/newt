import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

/** A column's removal is the cards' route (`card.routes.ts`): they know whether it is empty. */
export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => Response.json(await columns.add(request.params.boardId, await request.json()), { status: 201 }))

  workspace.patch('/columns/:columnId', async request => Response.json(await columns.rename(request.params.columnId, await request.json())))

  workspace.post('/columns/:columnId/move', async request => Response.json(await columns.move(request.params.columnId, await request.json())))
}
