import { pageRequestFrom, type KeptAnswer } from '@newt-kit/newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  // A client may send it again with the same `Idempotency-Key` (its answer lost on the
  // way): it gets the card made the first time, kept in the store, not a second one.
  workspace.post('/boards/:boardId/cards', async request => Response.json(await cards.create(request.params.boardId, await request.json()), { status: 201 }), { idempotency: { table: base.store.table<KeptAnswer>('idempotency_key') } })

  // A search sends its filter in the body: groups of conditions do not fit in a URL.
  workspace.post('/cards/search', async request => Response.json(await cards.search(await request.json(), pageRequestFrom(request))))

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => Response.json(await cards.edit(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/move', async request => Response.json(await cards.move(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/assign', async request => Response.json(await cards.assign(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))

  workspace.delete('/cards/:cardId', async request => {
    await cards.delete(request.params.cardId)
    return new Response(null, { status: 204 })
  })

  // A column is removed by the cards, which know whether it is empty.
  workspace.delete('/columns/:columnId', async request => {
    await cards.removeColumn(request.params.columnId)
    return new Response(null, { status: 204 })
  })
}
