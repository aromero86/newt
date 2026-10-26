import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Board,
  BoardCreateSchema,
  BoardUpdateSchema,
  type BoardDTO,
} from './board'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNotFound } from './errors/board-not-found'

/** The boards. */
export class Board_Module extends Module {

  static initialize(base: BoardsBase): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
  }

  /** A page of the boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    return mapPage(await this.repo.page({}, page, { newestFirst: true }), board => board.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    const board = Board.create({ name, description })
    await this.repo.persist(board)
    return board.toDTO()
  }

  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: unknown): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    board.update(changes)
    await this.repo.persist(board)
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
}
