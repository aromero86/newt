import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { Board, type BoardDTO } from './board'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board'), {
      // Archiving stamps `deletedAt`: an archived board is in no list.
      softDelete: true,
      // No scope yet: chapter 4 gives the boards their workspace's.
      scope: 'none',
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }
}
