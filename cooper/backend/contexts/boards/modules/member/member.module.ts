import { currentActor, Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import type { WorkspaceScope } from '../../workspace-scope'
import { WorkspaceNotFound } from './errors/workspace-not-found'
import type { Member_Deps } from './member.deps'

/**
 * Who belongs to each workspace, as `boards` asks it: the module that knows,
 * asked every time, never written in the actor. It keeps nothing: auth keeps the
 * workspaces and their members, and answers through the `Workspaces` port.
 */
export class Member_Module extends Module {

  static initialize(base: BoardsBase, deps: Member_Deps): Member_Module {
    return new Member_Module(base, deps)
  }

  private constructor(base: BoardsBase, private readonly deps: Member_Deps) {
    super('member', base.invocations)
  }

  /**
   * The workspace scope for the signed-in person, if they belong to it: what a route
   * under `/workspaces/:workspaceId` runs in. To anyone else it does not exist (404,
   * not 403: a private thing does not own up to existing).
   */
  @UseCase()
  async enter(workspaceId: string): Promise<WorkspaceScope> {
    if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
    return { workspaceId }
  }
}
