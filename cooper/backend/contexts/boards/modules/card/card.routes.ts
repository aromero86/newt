import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  workspace.post('/boards/:boardId/cards', async request => Response.json(await cards.create(request.params.boardId, await request.json()), { status: 201 }))

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => Response.json(await cards.edit(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/assign', async request => Response.json(await cards.assign(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))
}
