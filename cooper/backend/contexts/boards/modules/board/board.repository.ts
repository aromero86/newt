import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Board, type BoardDTO } from './board'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board'), {
      // Archiving stamps `deletedAt`: an archived board is in no list.
      softDelete: true,
      // Every find, count and page sees the current workspace's boards only.
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }

  /**
   * The boards created last, in every workspace: for the staff, who look across them
   * on purpose. Archived ones stay out.
   */
  recentInEveryScope(limit: number): Promise<Board[]> {
    return this.findInEveryScope({}, { limit, orderBy: [{ field: 'id', direction: 'desc' }] })
  }
}
