import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import {
  Column,
  ColumnAddSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
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

  private load(id: string): Promise<Column> {
    return this.resolve(() => this.repo.find({ id }), () => new ColumnNotFound(id))
  }
}
