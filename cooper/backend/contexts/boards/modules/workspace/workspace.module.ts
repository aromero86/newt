import { currentActor, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/initialize-modules'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import { WELCOME_BOARD, workspaceOf, type BoardViewDTO, type WorkspaceDTO, type WorkspaceMemberDTO } from './workspace.schema'
import { registerWorkspaceWorkers } from './workspace.workers'

/** Every item of a list read in pages: a person's workspaces, a workspace's members, are never many. */
export async function everything<T extends { id: string }>(read: (page: PageRequest) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  for (let page = await read({ size: 100 }); ; page = await read({ size: 100, cursor: items.at(-1)!.id })) {
    items.push(...page.items)
    if (!page.hasMore || page.items.length === 0) return items
  }
}

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
   * The workspaces the signed-in person belongs to, the ones they joined last first.
   * auth keeps them: this only reads it, its accesses to `cooper` and their tenants.
   */
  @UseCase()
  async mine(): Promise<WorkspaceDTO[]> {
    const { userId } = currentActor()
    const accesses = await everything(page => this.deps.auth.access.listForUser(userId, page, WORKSPACES_PRODUCT))
    const tenants = new Map((await this.deps.auth.tenant.getMany(accesses.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted a moment ago, whose accesses auth's worker has not taken away yet, is left out.
    return accesses.flatMap(access => {
      const tenant = tenants.get(access.tenantId ?? '')
      return tenant ? [workspaceOf(tenant, userId)] : []
    })
  }

  /**
   * Who belongs to the current workspace, its admin first: auth's accesses to it, and
   * the users they are for. It only reads auth.
   */
  @UseCase()
  async members(): Promise<WorkspaceMemberDTO[]> {
    const accesses = await everything(page => this.deps.auth.access.listForTenant(currentWorkspaceId(), page))
    const users = new Map((await this.deps.auth.user.getMany(accesses.map(access => access.userId))).map(user => [user.id, user]))
    return accesses.flatMap(access => {
      const user = users.get(access.userId)
      return user ? [{ id: user.id, name: user.name, email: user.email, isAdmin: access.role === 'admin' }] : []
    })
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
      const columns = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
      const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
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
