import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { WorkspaceNotFound } from '../workspace-member/errors/workspace-not-found'
import { WorkspaceNameTaken } from './errors/workspace-name-taken'
import { Workspace, WorkspaceCreateSchema, WorkspaceUpdateSchema, type WorkspaceCreateDTO, type WorkspaceDTO, type WorkspaceMineDTO, type WorkspaceUpdateDTO } from './workspace'
import type { Workspace_Deps } from './workspace.deps'
import { Workspace_Repository } from './workspace.repository'
import { registerWorkspaceRoutes } from './workspace.routes'

/** The workspaces: one per product, private to their members. */
export class Workspace_Module extends Module {

  static async initialize(base: Base, deps: Workspace_Deps) {
    const module = new Workspace_Module(base, new Workspace_Repository(base), deps)
    registerWorkspaceRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Workspace_Repository, private readonly deps: Workspace_Deps) {
    super('workspace', base.transactions)
  }

  /** Whoever creates a workspace is its admin, in the same transaction. */
  @UseCase('workspace.create')
  async create(input: WorkspaceCreateDTO): Promise<WorkspaceMineDTO> {
    const { name, description } = WorkspaceCreateSchema.parse(input)
    const { userId } = currentActor()
    await this.assertNameFree(userId, name)

    const workspace = Workspace.create({ name, description, createdBy: userId })
    await this.repo.persist(workspace)
    await this.deps.workspaceMember.join(workspace.id, userId, 'admin')
    return { ...workspace.toDTO(), myRole: 'admin' }
  }

  /**
   * A page of the workspaces the signed-in person is in, newest first, with their
   * role in each. The cursor is the id of the last workspace of the previous page.
   */
  @UseCase('workspace.mine')
  async mine(page: PageRequest): Promise<Page<WorkspaceMineDTO>> {
    const memberships = await this.deps.workspaceMember.myWorkspaces(page)
    const workspaces = memberships.items.length ? await this.repo.find({ id: memberships.items.map(membership => membership.workspaceId) }) : []
    const byId = new Map(workspaces.map(workspace => [workspace.id, workspace.toDTO()]))

    // The memberships give the order; the workspaces only their data.
    const items = memberships.items.flatMap(membership => {
      const workspace = byId.get(membership.workspaceId)
      return workspace ? [{ ...workspace, myRole: membership.role }] : []
    })
    return { ...memberships, items }
  }

  /** One workspace, for its members only. */
  @UseCase('workspace.get')
  async get(workspaceId: string): Promise<WorkspaceMineDTO> {
    const { role } = await this.deps.workspaceMember.assertActive(workspaceId)
    return { ...(await this.load(workspaceId)).toDTO(), myRole: role }
  }

  @UseCase('workspace.update')
  async update(workspaceId: string, input: WorkspaceUpdateDTO): Promise<WorkspaceDTO> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const changes = WorkspaceUpdateSchema.parse(input)
    const workspace = await this.load(workspaceId)
    if (changes.name !== undefined) await this.assertNameFree(workspace.toDTO().createdBy, changes.name, workspaceId)

    workspace.update(changes)
    await this.repo.persist(workspace)
    return workspace.toDTO()
  }

  @UseCase('workspace.archive')
  async archive(workspaceId: string): Promise<WorkspaceDTO> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const workspace = await this.load(workspaceId)
    workspace.archive()
    await this.repo.persist(workspace)
    return workspace.toDTO()
  }

  @UseCase('workspace.unarchive')
  async unarchive(workspaceId: string): Promise<WorkspaceDTO> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const workspace = await this.load(workspaceId)
    workspace.unarchive()
    await this.repo.persist(workspace)
    return workspace.toDTO()
  }

  /** For other modules that already checked who may see it. */
  @UseCase('workspace.find')
  async find(ids: string[]): Promise<WorkspaceDTO[]> {
    return (await this.repo.find({ id: ids })).map(workspace => workspace.toDTO())
  }

  private load(workspaceId: string): Promise<Workspace> {
    return this.resolve(() => this.repo.find({ id: [workspaceId] }), () => new WorkspaceNotFound(workspaceId))
  }

  private async assertNameFree(createdBy: string, name: string, exceptId?: string): Promise<void> {
    const same = await this.repo.find({ createdBy, name })
    if (same.some(workspace => workspace.id !== exceptId)) throw new WorkspaceNameTaken(name.trim())
  }
}
