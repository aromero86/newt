import { eventsOf, Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import {
  Column,
  ColumnAddSchema,
  ColumnMoveSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnAddDTO,
  type ColumnDTO,
  type ColumnMoveDTO,
  type ColumnRenameDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
import { TooManyColumns } from './errors/too-many-columns'
import { Column_Added } from './events/column-added'
import { Column_Moved } from './events/column-moved'
import { Column_Removed } from './events/column-removed'
import { Column_Renamed } from './events/column-renamed'

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

  readonly events

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations)
    this.events = eventsOf(base.bus, { added: Column_Added, renamed: Column_Renamed, moved: Column_Moved, removed: Column_Removed })
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
  async add(boardId: string, input: ColumnAddDTO): Promise<ColumnDTO> {
    const { name } = ColumnAddSchema.parse(input)
    await this.deps.board.get(boardId)
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
    const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
    await this.repo.persistAdded(column)
    return column.toDTO()
  }

  /**
   * Adds at the end of the board the columns of these names it does not have yet,
   * and answers all its columns: what a worker preparing a board calls, as many
   * times as it takes. Runs at once add each name once: the save checks it again.
   */
  @UseCase()
  async addMissing(boardId: string, names: string[]): Promise<ColumnDTO[]> {
    await this.deps.board.get(boardId)
    const columns = await this.repo.ofBoard(boardId)
    const missing = names.filter(name => !columns.some(column => column.name === name))
    if (missing.length === 0) return columns.map(column => column.toDTO())
    if (columns.length + missing.length > MAX_COLUMNS) throw new TooManyColumns(boardId)
    const added = missing.map((name, index) => Column.add({ workspaceId: currentWorkspaceId(), boardId, name: ColumnAddSchema.parse({ name }).name, position: columns.length + index }))
    await this.repo.persistMissing(added, boardId)
    return [...columns, ...added].map(column => column.toDTO())
  }

  @UseCase()
  async rename(id: string, input: ColumnRenameDTO): Promise<ColumnDTO> {
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
  async move(id: string, input: ColumnMoveDTO): Promise<ColumnDTO> {
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
   * first, and is what the API calls. A card left in it anyway (moved in at that very
   * moment) is taken to another column by a worker of the cards.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    column.remove()
    await this.repo.persistOrder([column, ...others], column.boardId)
  }

  /** A workspace was deleted in auth: its columns go. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }

  private load(id: string): Promise<Column> {
    return this.resolve(() => this.repo.find({ id }), () => new ColumnNotFound(id))
  }
}
