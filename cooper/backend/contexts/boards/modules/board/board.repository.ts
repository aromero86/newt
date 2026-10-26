import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Board, type BoardDTO } from './board'
import { BoardNameTaken } from './errors/board-name-taken'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
      softDelete: true,
      // Every find, count and page sees the current workspace's boards only.
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }

  /**
   * Saves a board only if no other one of its workspace has its name, whatever the
   * case: counted again after writing it, in its transaction, guarding the name in
   * lower case, so no other save of that name slips in between. `Roadmap` and
   * `ROADMAP` created at once cannot both have it (ch. 10).
   */
  async persistWithNameFree(board: Board): Promise<void> {
    const { workspaceId, name } = board
    await this.save([board], each => this.write(each), {
      guard: [`boardName:${workspaceId}:${name.toLowerCase()}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
      },
    })
  }

  /**
   * Removes every board of a workspace, archived ones too, for good: rows that will
   * tell nothing, so written with `saveRows`, by Kysely, inside its transaction. The
   * workspace is named, not the current one: auth deleted it, and nobody is in it.
   */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.base.db.deleteFrom('board').where('workspaceId', '=', workspaceId).execute()
    })
  }
}
