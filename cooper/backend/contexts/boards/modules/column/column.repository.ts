import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Column, MAX_COLUMNS, type ColumnDTO } from './column'
import { TooManyColumns } from './errors/too-many-columns'

export type ColumnRow = ColumnDTO & { version: number }

export class Column_Repository extends TableRepository<Column, ColumnRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ColumnRow>('column'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ColumnRow): Column {
    return Column.fromDTO(row)
  }

  /** A board's columns, from left to right. */
  ofBoard(boardId: string): Promise<Column[]> {
    return this.find({ boardId }, { orderBy: [{ field: 'position' }] })
  }

  /**
   * Saves a new column at the end of its board, only if the board is left with no more
   * than `MAX_COLUMNS`: a rule over several rows, which no version covers. The
   * save guards its board's columns: its place is read before writing it, and the
   * columns counted after, with no other column of the board added, moved or removed
   * in between, in any store. Ten added at once to a board of five: five get in.
   */
  async persistAdded(column: Column): Promise<void> {
    const { boardId } = column
    await this.save([column], each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => column.place(await this.count({ boardId })),
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
      },
    })
  }
}
