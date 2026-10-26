import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { TenantDTO, TenantFilterDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { PersonDTO } from '../user/user.schema'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import {
  WorkspaceSearchSchema,
  type RecentBoardDTO,
  type WorkspaceBoardDTO,
  type WorkspaceDetailDTO,
  type WorkspaceMemberDTO,
  type WorkspaceSearchDTO,
  type WorkspaceSummaryDTO,
} from './workspace.schema'

/** How many boards the overview shows as the latest. */
const RECENT_BOARDS = 8

/**
 * cooper's workspaces, as the staff look at them: auth keeps who they are and who
 * belongs to each, boards what is in them. This module keeps nothing: each screen is
 * put together from the use cases of the modules that know, a handful of
 * calls per page, never one per row.
 */
export class Workspace_Module extends Module {

  static initialize(base: CooperBase, deps: Workspace_Deps): Workspace_Module {
    const module = new Workspace_Module(base, deps)
    registerWorkspaceRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Workspace_Deps) {
    super('workspace', base.invocations)
  }

  /** Every workspace, the newest first; with a name, those with it. With its admin and its cards. */
  @UseCase()
  async list(input: WorkspaceSearchDTO, page: PageRequest): Promise<Page<WorkspaceSummaryDTO>> {
    const { name } = WorkspaceSearchSchema.parse(input)
    const filter: TenantFilterDTO | undefined = name ? { field: 'name', op: 'ieq', value: name } : undefined
    const found = await this.deps.tenant.list(filter, page)
    return { items: await this.summaries(found.items), hasMore: found.hasMore, total: found.total }
  }

  @UseCase()
  async get(workspaceId: string): Promise<WorkspaceDetailDTO> {
    const tenant = await this.deps.tenant.get(workspaceId)
    const [[summary], members, boards] = await Promise.all([
      this.summaries([tenant]),
      this.deps.access.listForTenant(workspaceId, { size: 1 }),
      this.deps.board.listOf(workspaceId, { size: 1 }),
    ])
    return { ...summary!, members: members.total, boards: boards.total }
  }

  /** Its members, the oldest first: its admin leads. */
  @UseCase()
  async members(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceMemberDTO>> {
    await this.deps.tenant.get(workspaceId)
    const accesses = await this.deps.access.listForTenant(workspaceId, page)
    const people = await this.people(accesses.items.map(access => access.userId))
    return {
      items: accesses.items.flatMap(access => {
        const person = people.get(access.userId)
        return person ? [{ ...person, id: access.id, userId: person.id, role: access.role, since: access.createdAt }] : []
      }),
      hasMore: accesses.hasMore,
      total: accesses.total,
    }
  }

  /** Its boards, the newest first, each with how many cards it has. */
  @UseCase()
  async boards(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceBoardDTO>> {
    await this.deps.tenant.get(workspaceId)
    const [boards, counts] = await Promise.all([
      this.deps.board.listOf(workspaceId, page),
      this.deps.card.countByBoard(workspaceId),
    ])
    const cards = new Map(counts.map(count => [count.boardId, count.cards]))
    return {
      items: boards.items.map(board => ({ id: board.id, name: board.name, description: board.description, createdAt: board.createdAt, cards: cards.get(board.id) ?? 0 })),
      hasMore: boards.hasMore,
      total: boards.total,
    }
  }

  /** The boards created last across every workspace, each with its workspace's name: two calls. */
  @UseCase()
  async recentBoards(): Promise<RecentBoardDTO[]> {
    const boards = await this.deps.board.recentInEveryWorkspace(RECENT_BOARDS)
    const tenants = new Map((await this.deps.tenant.getMany([...new Set(boards.map(board => board.workspaceId))])).map(tenant => [tenant.id, tenant.name]))
    return boards.map(board => ({ id: board.id, name: board.name, workspaceId: board.workspaceId, createdAt: board.createdAt, workspaceName: tenants.get(board.workspaceId) ?? null }))
  }

  /** Workspaces as the list shows them: two calls for the whole page, its admins and its cards. */
  private async summaries(tenants: TenantDTO[]): Promise<WorkspaceSummaryDTO[]> {
    const [admins, counts] = await Promise.all([
      this.people(tenants.map(tenant => tenant.createdBy)),
      this.deps.card.countByWorkspace(tenants.map(tenant => tenant.id)),
    ])
    const cards = new Map(counts.map(count => [count.workspaceId, count.cards]))
    return tenants.map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      createdAt: tenant.createdAt,
      admin: admins.get(tenant.createdBy) ?? null,
      cards: cards.get(tenant.id) ?? 0,
    }))
  }

  private async people(userIds: string[]): Promise<Map<string, PersonDTO>> {
    const users = await this.deps.user.getMany(userIds)
    return new Map(users.map(user => [user.id, { id: user.id, name: user.name, email: user.email }]))
  }
}
