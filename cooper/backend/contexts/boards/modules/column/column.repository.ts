import { ConcurrencyConflict } from 'newt/core'
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

  /**
   * Saves new columns at the end of their board, as `persistAdded` does, where none
   * of the board's other columns has their names: checked again after writing them,
   * guarding the board's columns. A save that finds one already there (another run
   * of the same work added it meanwhile) is a conflict, and the use case runs again,
   * finding it.
   */
  async persistMissing(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => {
        const count = await this.count({ boardId })
        columns.forEach((column, index) => column.place(count + index))
      },
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
        for (const column of columns) {
          if (await this.count({ boardId, name: column.name }) > 1) throw new ConcurrencyConflict()
        }
      },
    })
  }

  /**
   * Saves a board's columns in their new order, all of them or none: each
   * one moved, and the one removed. Each was read at a version, so a column moved by
   * someone else meanwhile makes it a conflict, and the use case runs again with what
   * there is now. One added meanwhile has no version here: the order is checked
   * whole after writing, guarding the board's columns, so it is a conflict too.
   */
  async persistOrder(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      after: async () => {
        const positions = (await this.ofBoard(boardId)).map(each => each.position)
        if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
      },
    })
  }

  /** Removes every column of a workspace for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
}
