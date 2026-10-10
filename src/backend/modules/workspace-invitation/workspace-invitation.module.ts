import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { AlreadyMember } from '../workspace-member/errors/already-member'
import { InvitationNotFound } from './errors/invitation-not-found'
import { WorkspaceInvitation_Created } from './events/workspace-invitation-created'
import { WorkspaceInvitation } from './workspace-invitation'
import type { WorkspaceInvitation_Deps } from './workspace-invitation.deps'
import type { WorkspaceInvitation_Options } from './workspace-invitation-options'
import { WorkspaceInvitation_Repository } from './workspace-invitation.repository'
import { registerWorkspaceInvitationRoutes } from './workspace-invitation.routes'
import {
  WorkspaceInvitationCreateSchema,
  type WorkspaceInvitationCreateDTO,
  type WorkspaceInvitationDTO,
  type WorkspaceInvitationResultDTO,
} from './workspace-invitation.schema'
import { registerWorkspaceInvitationWorkers } from './workspace-invitation.workers'

/** Bringing into a workspace someone who has no account yet. */
export class WorkspaceInvitation_Module extends Module {

  static async initialize(base: Base, deps: WorkspaceInvitation_Deps, options: WorkspaceInvitation_Options) {
    const module = new WorkspaceInvitation_Module(base, new WorkspaceInvitation_Repository(base), deps, options)
    registerWorkspaceInvitationRoutes(base, module)
    registerWorkspaceInvitationWorkers(module, deps)
    return module
  }

  readonly created

  private constructor(
    base: Base,
    private readonly repo: WorkspaceInvitation_Repository,
    private readonly deps: WorkspaceInvitation_Deps,
    readonly options: WorkspaceInvitation_Options,
  ) {
    super('workspaceInvitation', base.transactions)
    this.created = new DomainEventEmitter(base.bus, WorkspaceInvitation_Created)
  }

  /**
   * An admin brings in someone by email. With an account, they are a member at once;
   * without one, they get an invitation (replacing any pending one) by email.
   */
  @UseCase('workspaceInvitation.invite')
  async invite(workspaceId: string, input: WorkspaceInvitationCreateDTO): Promise<WorkspaceInvitationResultDTO> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const { email } = WorkspaceInvitationCreateSchema.parse(input)

    const [user] = await this.deps.user.find({ email })
    if (user) {
      if (await this.deps.workspaceMember.isActive(workspaceId, user.id)) throw new AlreadyMember(user.nick)
      await this.deps.workspaceMember.join(workspaceId, user.id, 'member')
      return { result: 'added' }
    }

    for (const pending of await this.repo.find({ workspaceId, email, pending: true })) {
      pending.cancel()
      await this.repo.persist(pending)
    }
    const [workspace] = await this.deps.workspace.find([workspaceId])
    const [inviter] = await this.deps.user.find({ id: [currentActor().userId] })
    await this.repo.persist(WorkspaceInvitation.create({ workspaceId, workspaceName: workspace!.name, email, invitedBy: inviter! }, this.options.days))
    return { result: 'invited' }
  }

  /** A page of the workspace's pending invitations, oldest first. Admins only. */
  @UseCase('workspaceInvitation.pending')
  async pending(workspaceId: string, page: PageRequest): Promise<Page<WorkspaceInvitationDTO>> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const invitations = await this.repo.pageOfPending(workspaceId, page)
    const inviters = await this.deps.user.find({ id: [...new Set(invitations.items.map(invitation => invitation.invitedBy))] })
    const nicks = new Map(inviters.map(user => [user.id, user.nick]))

    const items = invitations.items.map(invitation => {
      const { id, email, expiresAt, createdAt } = invitation.toDTO()
      return { id, email, invitedByNick: nicks.get(invitation.invitedBy) ?? '', expiresAt, createdAt }
    })
    return { ...invitations, items }
  }

  @UseCase('workspaceInvitation.cancel')
  async cancel(workspaceId: string, invitationId: string): Promise<void> {
    await this.deps.workspaceMember.assertAdmin(workspaceId)
    const [invitation] = await this.repo.find({ id: [invitationId], workspaceId, pending: true })
    if (!invitation) throw new InvitationNotFound(invitationId)

    invitation.cancel()
    await this.repo.persist(invitation)
  }

  /** Someone just signed up: every pending invitation for their email lets them in. */
  @UseCase('workspaceInvitation.acceptFor')
  async acceptFor(user: { id: string, email: string }): Promise<void> {
    for (const invitation of await this.repo.find({ email: user.email, pending: true })) {
      await this.deps.workspaceMember.join(invitation.workspaceId, user.id, 'member')
      invitation.accept()
      await this.repo.persist(invitation)
    }
  }
}
