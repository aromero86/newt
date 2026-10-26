import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import { WELCOME_BOARD, type BoardViewDTO } from './workspace.schema'
import { registerWorkspaceWorkers } from './workspace.workers'

/**
 * A workspace as `boards` has it: what its boards, columns and cards are together.
 * It keeps nothing of its own: it puts the other modules to work, from a worker when
 * it writes in them, and reads them all at once for a board's screen.
 */
export class Workspace_Module extends Module {

  static initialize(base: BoardsBase, deps: Workspace_Deps): Workspace_Module {
    const module = new Workspace_Module(base, deps)
    registerWorkspaceRoutes(base, module, deps)
    registerWorkspaceWorkers(module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly deps: Workspace_Deps) {
    super('workspace', base.invocations)
  }

  /** A board, its columns and its cards, in the current workspace: one screen. */
  @UseCase()
  async boardView(boardId: string): Promise<BoardViewDTO> {
    const board = await this.deps.board.get(boardId)
    const [columns, cards] = await Promise.all([this.deps.column.list(boardId), this.deps.card.listInBoard(boardId)])
    return { board, columns, cards }
  }

  /**
   * A new workspace gets its welcome board: "Welcome", with To do, Doing and Done, and
   * a first card. A worker calls it once auth created the workspace (eventual
   * consistency: for a moment, the workspace has no board), and it writes in three
   * modules, which only a worker may (ch. 19): if it fails halfway, its job runs it
   * again. Each step looks for what an earlier run did first, so a second run only
   * finishes what the first left (ch. 15), and adds nothing to a finished one.
   */
  @UseCase()
  async prepare(workspaceId: string): Promise<void> {
    await runInWorkspace(workspaceId, async () => {
      const board = await this.deps.board.findByName(WELCOME_BOARD.name)
        ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
      const columns = await this.deps.column.list(board.id)
      for (const name of WELCOME_BOARD.columns) {
        if (!columns.some(column => column.name === name)) columns.push(await this.deps.column.add(board.id, { name }))
      }
      if ((await this.deps.card.listInBoard(board.id)).length > 0) return
      const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
      await this.deps.card.create(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
    })
  }

  /**
   * auth deleted a workspace: its cards, columns and boards go, in that order. boards'
   * step of that deletion (ch. 18): it cannot be undone, nor needs to be; a worker
   * runs it until it completes, and each part removes what is left, so running it
   * again after a failure halfway converges on a workspace with nothing.
   */
  @UseCase()
  async purge(workspaceId: string): Promise<void> {
    await this.deps.card.purgeWorkspace(workspaceId)
    await this.deps.column.purgeWorkspace(workspaceId)
    await this.deps.board.purgeWorkspace(workspaceId)
  }
}
