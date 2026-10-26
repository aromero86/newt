import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import {
  Column,
  ColumnAddSchema,
  ColumnMoveSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
import { LastColumn } from './errors/last-column'
import { TooManyColumns } from './errors/too-many-columns'

/**
 * The columns of each board: the statuses its cards go through, in order. It knows
 * its boards; it does not know the cards, which point at their column.
 */
export class Column_Module extends Module {

  static initialize(base: BoardsBase, deps: Column_Deps): Column_Module {
    const module = new Column_Module(base, new Column_Repository(base), deps)
    registerColumnRoutes(base, module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations)
  }

  /**
   * A board's columns, from left to right: whole, since a board has at most
   * `MAX_COLUMNS`. A board the workspace does not have has none.
   */
  @UseCase()
  async list(boardId: string): Promise<ColumnDTO[]> {
    return (await this.repo.ofBoard(boardId)).map(column => column.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<ColumnDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A new column, at the end of the board: a board has at most `MAX_COLUMNS`. */
  @UseCase()
  async add(boardId: string, input: unknown): Promise<ColumnDTO> {
    const { name } = ColumnAddSchema.parse(input)
    await this.deps.board.get(boardId)
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
    const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
    await this.repo.persistAdded(column)
    return column.toDTO()
  }

  @UseCase()
  async rename(id: string, input: unknown): Promise<ColumnDTO> {
    const { name } = ColumnRenameSchema.parse(input)
    const column = await this.load(id)
    column.rename(name)
    await this.repo.persist(column)
    return column.toDTO()
  }

  /**
   * Moves a column to another place on its board, and the others take the places
   * left: several columns saved at once, all or none. Whoever moved one of them
   * meanwhile makes it run again, from the start, with the board as it is then.
   */
  @UseCase()
  async move(id: string, input: unknown): Promise<ColumnDTO> {
    const { position } = ColumnMoveSchema.parse(input)
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    const at = Math.min(position, others.length)
    others.splice(at, 0, column)
    others.forEach((each, index) => each === column ? column.moveTo(index) : each.reposition(index))
    await this.repo.persistOrder(others, column.boardId)
    return column.toDTO()
  }

  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls. A board keeps one column at least: its last one
   * is not removed.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (others.length === 0) throw new LastColumn(column.boardId)
    others.forEach((each, index) => each.reposition(index))
    column.remove()
    await this.repo.persistOrder([column, ...others], column.boardId)
  }

  private load(id: string): Promise<Column> {
    return this.resolve(() => this.repo.find({ id }), () => new ColumnNotFound(id))
  }
}
