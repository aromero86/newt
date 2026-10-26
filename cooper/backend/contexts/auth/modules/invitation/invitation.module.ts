import { currentActor, Email, eventsOf, Module, SecretToken, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { NotTenantAdmin } from '../tenant/errors/not-tenant-admin'
import { TenantNotFound } from '../tenant/errors/tenant-not-found'
import { AlreadyInvited } from './errors/already-invited'
import { InvitationForAnotherEmail } from './errors/invitation-for-another-email'
import { InvitationNotFound } from './errors/invitation-not-found'
import { InvitationNotOpen } from './errors/invitation-not-open'
import { Invitation_Accepted } from './events/invitation-accepted'
import { Invitation_Created } from './events/invitation-created'
import { Invitation_Revoked } from './events/invitation-revoked'
import { Invitation, InvitationCreateSchema, type InvitationCreateDTO, type InvitationDTO, type InvitationReviewDTO } from './invitation'
import type { Invitation_Deps } from './invitation.deps'
import type { Invitation_Options } from './invitation-options'
import { Invitation_Repository } from './invitation.repository'
import { registerInvitationWorkers } from './invitation.workers'

/**
 * Invitations to join a workspace: its admin invites by email, the email leaves from
 * a worker, and whoever signs in with that email accepts it and becomes a member.
 */
export class Invitation_Module extends Module {

  static initialize(base: AuthBase, deps: Invitation_Deps, options: Invitation_Options): Invitation_Module {
    const module = new Invitation_Module(base, new Invitation_Repository(base), deps, options)
    registerInvitationWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(
    base: AuthBase,
    private readonly repo: Invitation_Repository,
    private readonly deps: Invitation_Deps,
    private readonly options: Invitation_Options,
  ) {
    super('invitation', base.invocations)
    this.events = eventsOf(base.bus, { created: Invitation_Created, accepted: Invitation_Accepted, revoked: Invitation_Revoked })
  }

  /** The workspace's admin invites an email, which is not a member nor invited already. Its email leaves from a worker. */
  @UseCase()
  async create(tenantId: string, input: InvitationCreateDTO): Promise<InvitationDTO> {
    const email = Email.from(InvitationCreateSchema.parse(input).email)
    await this.assertAdmin(tenantId)
    const invited = await this.deps.user.findByEmail(email)
    const member = invited ? await this.deps.access.check(invited.id, this.options.productId, tenantId) : null
    if (member || await this.repo.count({ tenantId, email, status: 'pending' }) > 0) throw new AlreadyInvited(email)

    const invitation = Invitation.create({ tenantId, email, invitedBy: currentActor().userId, days: this.options.days })
    await this.repo.persist(invitation)
    return invitation.contract()
  }

  /** The invitations of a workspace still waiting, the newest first: for its admin. */
  @UseCase()
  async list(tenantId: string, page: PageRequest): Promise<Page<InvitationDTO>> {
    await this.assertAdmin(tenantId)
    const found = await this.repo.page({ tenantId, status: 'pending' }, page, { newestFirst: true })
    return { items: found.items.map(invitation => invitation.contract()), hasMore: found.hasMore, total: found.total }
  }

  /** Its workspace's admin takes it back: its link opens nothing from then on. */
  @UseCase()
  async revoke(invitationId: string): Promise<void> {
    const invitation = await this.resolve(() => this.repo.find({ id: invitationId }), () => new InvitationNotFound())
    await this.assertAdmin(invitation.tenantId)
    if (invitation.status !== 'pending') throw new InvitationNotOpen()
    invitation.revoke()
    await this.repo.persist(invitation)
  }

  /** What the link's page shows before accepting it: to anyone who has the link. */
  @UseCase()
  async review(token: string): Promise<InvitationReviewDTO> {
    const invitation = await this.byToken(token)
    const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
    if (!tenant) throw new InvitationNotFound()
    const inviter = await this.deps.user.get(invitation.invitedBy)
    return { tenantId: tenant.id, tenantName: tenant.name, email: invitation.email, invitedByName: inviter.name, open: invitation.isOpen() }
  }

  /**
   * The signed-in person accepts it, if they have its email: they become a member of
   * the workspace. It writes to `access` without being a worker, on purpose: whoever
   * accepts enters at once. The access goes first, and is safe to give again: should
   * the invitation fail to be marked accepted, accepting again finishes it.
   */
  @UseCase({ writesTo: ['access'] })
  async accept(token: string): Promise<InvitationDTO> {
    const invitation = await this.byToken(token)
    if (!invitation.isOpen()) throw new InvitationNotOpen()
    const { userId } = currentActor()
    const me = await this.deps.user.get(userId)
    if (me.email !== invitation.email) throw new InvitationForAnotherEmail(invitation.email)

    await this.deps.access.admit({ userId, productId: this.options.productId, tenantId: invitation.tenantId, role: 'member' })
    invitation.accept(userId)
    await this.repo.persist(invitation)
    return invitation.contract()
  }

  /**
   * Sends its email, with a new token for its link: what its worker calls once it is
   * saved, since an email cannot be taken back. The token is made here, not when it
   * was created, so it is never kept in a job: the store only ever has its hash. Run
   * again, it sends a new link, and the one before stops working.
   */
  @UseCase()
  async send(invitationId: string): Promise<void> {
    const invitation = await this.repo.first({ id: invitationId })
    if (!invitation?.isOpen()) return
    const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
    if (!tenant) return
    const inviter = await this.deps.user.get(invitation.invitedBy)

    const token = invitation.issueToken()
    await this.repo.persist(invitation)
    await this.options.mailer.send({
      to: invitation.email,
      subject: `${inviter.name} invited you to ${tenant.name} on Cooper`,
      text: [
        `${inviter.name} invited you to join the workspace ${tenant.name} on Cooper.`,
        '',
        `Accept the invitation: ${this.options.acceptUrl(token)}`,
        '',
        `Sign in, or sign up, with ${invitation.email} to accept it. It expires on ${invitation.expiresAt.slice(0, 10)}.`,
      ].join('\n'),
    })
  }

  /** A deleted workspace's invitations open nothing: a step of its deletion, from a worker. Safe to run again. */
  @UseCase()
  async revokeForTenant(tenantId: string): Promise<void> {
    const pending = await this.repo.find({ tenantId, status: 'pending' })
    for (const invitation of pending) invitation.revoke()
    await this.repo.persist(...pending)
  }

  private async byToken(token: string): Promise<Invitation> {
    const parsed = SecretToken.schema.safeParse(token)
    const invitation = parsed.success ? await this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
    if (!invitation) throw new InvitationNotFound()
    return invitation
  }

  /** The signed-in person is the workspace's admin. Who is not even a member is told it does not exist. */
  private async assertAdmin(tenantId: string): Promise<void> {
    const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
    if (!access) throw new TenantNotFound(tenantId)
    if (access.role !== 'admin') throw new NotTenantAdmin()
  }
}
