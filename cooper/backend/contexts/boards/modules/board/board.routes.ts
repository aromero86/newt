import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module): void {
  base.http.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  base.http.post('/boards', async request => Response.json(await boards.create(await request.json()), { status: 201 }))

  base.http.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  base.http.patch('/boards/:boardId', async request => Response.json(await boards.update(request.params.boardId, await request.json())))

  base.http.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
