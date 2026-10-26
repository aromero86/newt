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
   * modules, which only a worker may: if it fails halfway, its job runs it again.
   * Each step looks for what an earlier run did first, so a second run only finishes
   * what the first left, and adds nothing to a finished one; two runs at once add
   * each column and the card once, since their saves look again.
   *
   * A workspace auth deleted meanwhile gets nothing: its job may run late, after the
   * workspace's purge. One deleted while it runs has what it wrote purged again.
   */
  @UseCase()
  async prepare(workspaceId: string): Promise<void> {
    if (!await this.deps.member.exists(workspaceId)) return
    await runInWorkspace(workspaceId, async () => {
      const board = await this.deps.board.findByName(WELCOME_BOARD.name)
        ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
      const [todo] = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
      await this.deps.card.createFirst(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
    })
    if (!await this.deps.member.exists(workspaceId)) await this.purge(workspaceId)
  }

  /**
   * auth deleted a workspace: its cards, columns and boards go, in that order. boards'
   * step of that deletion: it cannot be undone, nor needs to be; a worker
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
