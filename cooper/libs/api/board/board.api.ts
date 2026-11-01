import type { BoardCreateDTO, BoardDTO, BoardUpdateDTO } from '../../../backend/contexts/boards/modules/board/board.schema'
import type { BoardViewDTO } from '../../../backend/contexts/boards/modules/workspace/workspace.schema'
import type { Page } from '@newt-kit/newt/contract'
import { type PageRequest, Requester } from '@newt-kit/react'

/** The backend's `board` module: a workspace's boards. */
export class BoardApi extends Requester {
  protected readonly path = '/workspaces'

  /** A page of the workspace's boards, the newest first. */
  list(workspaceId: string, page?: PageRequest) {
    return this.get<Page<BoardDTO>>(`/${workspaceId}/boards`, page)
  }

  getBoard(workspaceId: string, boardId: string) {
    return this.get<BoardDTO>(`/${workspaceId}/boards/${boardId}`)
  }

  /** A board as its screen shows it: the board, its columns and their cards. */
  view(workspaceId: string, boardId: string) {
    return this.get<BoardViewDTO>(`/${workspaceId}/boards/${boardId}/view`)
  }

  create(workspaceId: string, input: BoardCreateDTO) {
    return this.post<BoardDTO>(`/${workspaceId}/boards`, input)
  }

  /** Renames it, describes it, or both. */
  update(workspaceId: string, boardId: string, input: BoardUpdateDTO) {
    return this.patch<BoardDTO>(`/${workspaceId}/boards/${boardId}`, input)
  }

  archive(workspaceId: string, boardId: string) {
    return this.post<void>(`/${workspaceId}/boards/${boardId}/archive`)
  }
}
