import { currentActor, Module, UseCase } from '@newt-kit/newt/core'
import { WORKSPACES_PRODUCT } from '../../../auth/modules/product/product.schema'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, type WorkspaceScope } from '../../workspace-scope'
import { WorkspaceNotFound } from './errors/workspace-not-found'
import type { Member_Deps } from './member.deps'
import type { MemberDTO } from './member.schema'

/**
 * Who belongs to each workspace, as `boards` asks it: the module that knows,
 * asked every time, never written in the actor. It keeps nothing: auth keeps the
 * workspaces (tenants of the product `cooper`) and who has access to each, and this
 * module asks it. A member is someone with access to a workspace still there.
 */
export class Member_Module extends Module {

  static initialize(base: BoardsBase, deps: Member_Deps): Member_Module {
    return new Member_Module(base, deps)
  }

  private constructor(base: BoardsBase, private readonly deps: Member_Deps) {
    super('member', base.invocations, deps)
  }

  /**
   * The workspace scope for the signed-in person, if they belong to it: what a route
   * under `/workspaces/:workspaceId` runs in. To anyone else it does not exist (404,
   * not 403: a private thing does not own up to existing).
   */
  @UseCase()
  async enter(workspaceId: string): Promise<WorkspaceScope> {
    if (!await this.belongs(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
    return { workspaceId }
  }

  /** Whether someone belongs to the current workspace. */
  @UseCase()
  async isMember(userId: string): Promise<boolean> {
    return this.belongs(currentWorkspaceId(), userId)
  }

  /** Whether a workspace is still there: what a worker that writes in one asks first. */
  @UseCase()
  async exists(workspaceId: string): Promise<boolean> {
    return this.isThere(workspaceId)
  }

  /** Someone of a workspace, or null if they do not belong to it (any more): what a worker, outside any scope, asks. */
  @UseCase()
  async find(workspaceId: string, userId: string): Promise<MemberDTO | null> {
    if (!await this.belongs(workspaceId, userId)) return null
    const [found] = await this.deps.auth.user.getMany([userId])
    return found ? { id: found.id, name: found.name, email: found.email, avatarUrl: found.avatarUrl } : null
  }

  /**
   * An access and a workspace still there, asked each time so who leaves counts at
   * once: a deleted workspace's accesses go a moment after it (or, should that fail,
   * from its worker), and nobody enters it meanwhile.
   */
  private async belongs(workspaceId: string, userId: string): Promise<boolean> {
    const [granted, alive] = await Promise.all([this.deps.auth.access.check(userId, WORKSPACES_PRODUCT, workspaceId), this.isThere(workspaceId)])
    return granted !== null && alive
  }

  /** A deleted tenant is not among them. */
  private async isThere(workspaceId: string): Promise<boolean> {
    return (await this.deps.auth.tenant.getMany([workspaceId])).length > 0
  }
}
