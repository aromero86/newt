import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
import {
  Board,
  BoardCreateSchema,
  BoardUpdateSchema,
  type BoardDTO,
} from './board'
import type { Board_Deps } from './board.deps'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNameTaken } from './errors/board-name-taken'
import { BoardNotFound } from './errors/board-not-found'
import { BoardName } from './value-objects/board-name'

/**
 * The boards of each workspace. Every use case works in the current workspace (the
 * scope its route, worker or script entered): the repository sees no other. Those
 * another context calls name their workspace instead, and enter it.
 */
export class Board_Module extends Module {

  static initialize(base: BoardsBase, deps: Board_Deps): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
  }

  /** A page of the workspace's boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    return mapPage(await this.repo.page({}, page, { newestFirst: true }), board => board.toDTO())
  }

  /** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
  @UseCase()
  async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
    return runInWorkspace(workspaceId, () => this.list(page))
  }

  /**
   * For the staff's backoffice: the boards created last, whatever their workspace. It
   * reads every workspace on purpose, so it does not run in one: no person of a
   * workspace reaches it (no route of boards calls it), and its repository says so by
   * name (`findInEveryScope`), where a review sees it.
   */
  @UseCase()
  async recentInEveryWorkspace(limit: number): Promise<BoardDTO[]> {
    const boards = await this.repo.recentInEveryScope(Math.min(Math.max(limit, 1), 50))
    return boards.map(board => board.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  /** For other modules: the board with this name, whatever its case, if there is one. */
  @UseCase()
  async findByName(name: string): Promise<BoardDTO | null> {
    const board = await this.repo.first({ name: { ieq: BoardName.from(name) } })
    return board?.toDTO() ?? null
  }

  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    await this.assertNameFree(BoardName.from(name))
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }

  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: unknown): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }

  /** Out of every list for good; its columns and cards stay, pointing at it. */
  @UseCase()
  async archive(id: string): Promise<void> {
    const board = await this.load(id)
    board.archive()
    await this.repo.persist(board)
  }

  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
  }
}
