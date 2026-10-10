import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { AlreadyMember } from './errors/already-member'
import { LastAdmin } from './errors/last-admin'
import { MemberNotFound } from './errors/member-not-found'
import { NoSuchNick } from './errors/no-such-nick'
import { NotWorkspaceAdmin } from './errors/not-workspace-admin'
import { WorkspaceNotFound } from './errors/workspace-not-found'
import { WorkspaceMember } from './workspace-member'
import type { WorkspaceMember_Deps } from './workspace-member.deps'
import { WorkspaceMember_Repository } from './workspace-member.repository'
import { registerWorkspaceMemberRoutes } from './workspace-member.routes'
import {
  WorkspaceMemberAddSchema,
  WorkspaceMemberRoleChangeSchema,
  type WorkspaceMemberAddDTO,
  type WorkspaceMemberDTO,
  type WorkspaceMemberRole,
  type WorkspaceMemberRoleChangeDTO,
} from './workspace-member.schema'

/** Who belongs to each workspace, with which role, and who has left. */
export class WorkspaceMember_Module extends Module {

  static async initialize(base: Base, deps: WorkspaceMember_Deps) {
    const module = new WorkspaceMember_Module(base, new WorkspaceMember_Repository(base), deps)
    registerWorkspaceMemberRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: WorkspaceMember_Repository, private readonly deps: WorkspaceMember_Deps) {
    super('workspaceMember', base.transactions)
  }

  /**
   * Puts a user in a workspace, or back in if they had left. For other modules
   * (creating a workspace, accepting an invitation): it checks nobody's rights.
   */
  @UseCase('workspaceMember.join')
  async join(workspaceId: string, userId: string, role: WorkspaceMemberRole): Promise<void> {
    const [member] = await this.repo.find({ workspaceId, userId: [userId] })
    if (member?.active) return
    if (member) member.rejoin(role)
    await this.repo.persist(member ?? WorkspaceMember.join(workspaceId, userId, role))
  }

  /** The signed-in person is an active member, or the workspace does not exist for them. */
  @UseCase('workspaceMember.assertActive')
  async assertActive(workspaceId: string): Promise<{ role: WorkspaceMemberRole }> {
    const member = await this.activeMember(workspaceId, currentActor().userId)
    if (!member) throw new WorkspaceNotFound(workspaceId)
    return { role: member.role }
  }

  /** The signed-in person is an admin of the workspace. */
  @UseCase('workspaceMember.assertAdmin')
  async assertAdmin(workspaceId: string): Promise<void> {
    const { role } = await this.assertActive(workspaceId)
    if (role !== 'admin') throw new NotWorkspaceAdmin()
  }

  /** A page of the workspaces the signed-in person is an active member of, newest first. */
  @UseCase('workspaceMember.myWorkspaces')
  async myWorkspaces(page: PageRequest): Promise<Page<{ workspaceId: string, role: WorkspaceMemberRole }>> {
    const members = await this.repo.pageOfUser(currentActor().userId, page)
    return { ...members, items: members.items.map(member => ({ workspaceId: member.workspaceId, role: member.role })) }
  }

  /** Whether a user is an active member: for other modules that already checked the asker. */
  @UseCase('workspaceMember.isActive')
  async isActive(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.activeMember(workspaceId, userId)) !== null
  }

  /** A page of everyone who is or was in the workspace, in the order they joined. Any active member sees it. */
  @UseCase('workspaceMember.list')
  async list(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceMemberDTO>> {
    await this.assertActive(workspaceId)
    const members = await this.repo.pageOfWorkspace(workspaceId, page)
    const users = await this.deps.user.find({ id: members.items.map(member => member.userId) })
    const byId = new Map(users.map(user => [user.id, user]))

    const items = members.items.flatMap(member => {
      const user = byId.get(member.userId)
      if (!user) return []
      const { id, createdAt } = member.toDTO()
      return [{ id, userId: user.id, nick: user.nick, fullName: user.fullName, role: member.role, active: member.active, since: createdAt }]
    })
    return { ...members, items }
  }

  /** An admin adds someone with an account, by nick. */
  @UseCase('workspaceMember.add')
  async add(workspaceId: string, input: WorkspaceMemberAddDTO): Promise<void> {
    await this.assertAdmin(workspaceId)
    const { nick } = WorkspaceMemberAddSchema.parse(input)

    const [user] = await this.deps.user.find({ nick })
    if (!user) throw new NoSuchNick(nick)
    if (await this.activeMember(workspaceId, user.id)) throw new AlreadyMember(user.nick)

    await this.join(workspaceId, user.id, 'member')
  }

  /** The signed-in person leaves. The last admin cannot. */
  @UseCase('workspaceMember.leave')
  async leave(workspaceId: string): Promise<void> {
    await this.assertActive(workspaceId)
    await this.deactivate(workspaceId, currentActor().userId)
  }

  /** An admin takes someone out. They stay, inactive, as the author of what they did. */
  @UseCase('workspaceMember.remove')
  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.assertAdmin(workspaceId)
    await this.deactivate(workspaceId, userId)
  }

  @UseCase('workspaceMember.changeRole')
  async changeRole(workspaceId: string, userId: string, input: WorkspaceMemberRoleChangeDTO): Promise<void> {
    await this.assertAdmin(workspaceId)
    const { role } = WorkspaceMemberRoleChangeSchema.parse(input)

    const member = await this.activeMember(workspaceId, userId)
    if (!member) throw new MemberNotFound(userId)
    if (member.isActiveAdmin && role !== 'admin') await this.assertNotLastAdmin(workspaceId)

    member.changeRole(role)
    await this.repo.persist(member)
  }

  private async deactivate(workspaceId: string, userId: string): Promise<void> {
    const member = await this.activeMember(workspaceId, userId)
    if (!member) throw new MemberNotFound(userId)
    if (member.isActiveAdmin) await this.assertNotLastAdmin(workspaceId)

    member.leave()
    await this.repo.persist(member)
  }

  private async assertNotLastAdmin(workspaceId: string): Promise<void> {
    const members = await this.repo.find({ workspaceId, active: true })
    if (members.filter(member => member.isActiveAdmin).length <= 1) throw new LastAdmin()
  }

  private async activeMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const [member] = await this.repo.find({ workspaceId, userId: [userId], active: true })
    return member ?? null
  }
}
