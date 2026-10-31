import { z } from 'zod'
import { Email, Entity, now, SecretToken, type EntityInput } from 'newt/core'
import { Invitation_Accepted } from './events/invitation-accepted'
import { Invitation_Created } from './events/invitation-created'
import { Invitation_Revoked } from './events/invitation-revoked'
import { InvitationSchema, type InvitationStatus } from './invitation.schema'

export * from './invitation.schema'

/** The invitation as it is kept: what anyone sees, and the hash of its link's token. */
const InvitationEntitySchema = InvitationSchema.extend({
  /** Null until its email leaves: the token is made when it is sent, and only its hash kept. */
  tokenHash: z.string().nullable(),
})

export type InvitationEntityDTO = z.infer<typeof InvitationEntitySchema>

/** An invitation to join a workspace, sent by email, accepted by whoever signs in with that email. */
export class Invitation extends Entity<typeof InvitationEntitySchema, typeof InvitationSchema> {

  private constructor(input: EntityInput<InvitationEntityDTO>, isNew: boolean) {
    super(InvitationEntitySchema, input, isNew, InvitationSchema)
  }

  static fromDTO(dto: InvitationEntityDTO & { version: number }): Invitation {
    return new Invitation(dto, false)
  }

  /** A new one, pending for some days: the email as someone typed it becomes an `Email`. */
  static create(input: { tenantId: string, email: string, invitedBy: string, days: number }): Invitation {
    const { days, ...rest } = input
    const expiresAt = new Date(now().getTime() + days * 24 * 60 * 60_000).toISOString()
    const invitation = new Invitation({ ...rest, email: Email.from(rest.email), status: 'pending', acceptedBy: null, expiresAt, tokenHash: null }, true)
    invitation.trackEvent(new Invitation_Created(invitation.toDTO()))
    return invitation
  }

  get tenantId(): string {
    return this.data.tenantId
  }

  get email(): Email {
    return this.data.email
  }

  get invitedBy(): string {
    return this.data.invitedBy
  }

  get status(): InvitationStatus {
    return this.data.status
  }

  get expiresAt(): string {
    return this.data.expiresAt
  }

  /** Pending and not expired: it can still be accepted. */
  isOpen(at = now()): boolean {
    return this.data.status === 'pending' && new Date(this.data.expiresAt) > at
  }

  /** Accepted by this person and not expired: accepting it again finishes what the first time left. */
  isAcceptedBy(userId: string, at = now()): boolean {
    return this.data.status === 'accepted' && this.data.acceptedBy === userId && new Date(this.data.expiresAt) > at
  }

  /**
   * A new token for its link, which only the email will carry: the one before, if
   * any, stops working. The store keeps its hash.
   */
  issueToken(): SecretToken {
    const token = SecretToken.generate()
    this.change({ tokenHash: SecretToken.hash(token) })
    return token
  }

  accept(userId: string): void {
    this.change({ status: 'accepted', acceptedBy: userId })
    this.trackEvent(new Invitation_Accepted(this.toDTO()))
  }

  revoke(): void {
    this.change({ status: 'revoked' })
    this.trackEvent(new Invitation_Revoked(this.toDTO()))
  }
}
