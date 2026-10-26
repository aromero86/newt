import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { ColumnAddDTO, ColumnMoveDTO, ColumnRenameDTO } from './column'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

/** A column's removal is the cards' route (`card.routes.ts`): they know whether it is empty. */
export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => {
    const input = await request.json() as ColumnAddDTO
    return Response.json(await columns.add(request.params.boardId, input), { status: 201 })
  })

  workspace.patch('/columns/:columnId', async request => {
    const input = await request.json() as ColumnRenameDTO
    return Response.json(await columns.rename(request.params.columnId, input))
  })

  workspace.post('/columns/:columnId/move', async request => {
    const input = await request.json() as ColumnMoveDTO
    return Response.json(await columns.move(request.params.columnId, input))
  })
}
