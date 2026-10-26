import { z } from 'zod'
import { Entity, SecretToken, type Email, type EntityInput } from 'newt/core'
import { Invitation_Accepted } from './events/invitation-accepted'
import { Invitation_Created } from './events/invitation-created'
import { Invitation_Revoked } from './events/invitation-revoked'
import { InvitationSchema, type InvitationDTO, type InvitationStatus } from './invitation.schema'

export * from './invitation.schema'

/** The invitation as it is kept: what anyone sees, and the hash of its link's token. */
const InvitationEntitySchema = InvitationSchema.extend({
  /** Null until its email leaves: the token is made when it is sent, and only its hash kept. */
  tokenHash: z.string().nullable(),
})

export type InvitationEntityDTO = z.infer<typeof InvitationEntitySchema>

/** An invitation to join a workspace, sent by email, accepted by whoever signs in with that email. */
export class Invitation extends Entity<typeof InvitationEntitySchema> {

  private constructor(input: EntityInput<InvitationEntityDTO>, isNew: boolean) {
    super(InvitationEntitySchema, input, isNew)
  }

  static fromDTO(dto: InvitationEntityDTO & { version: number }): Invitation {
    return new Invitation(dto, false)
  }

  static create(input: { tenantId: string, email: Email, invitedBy: string, days: number }): Invitation {
    const { days, ...rest } = input
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
    const invitation = new Invitation({ ...rest, status: 'pending', acceptedBy: null, expiresAt, tokenHash: null }, true)
    invitation.trackEvent(new Invitation_Created(invitation.contract()))
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
  isOpen(now = new Date()): boolean {
    return this.data.status === 'pending' && new Date(this.data.expiresAt) > now
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
    this.trackEvent(new Invitation_Accepted(this.contract()))
  }

  revoke(): void {
    this.change({ status: 'revoked' })
    this.trackEvent(new Invitation_Revoked(this.contract()))
  }

  /** What anyone else sees of it: never its token's hash. */
  contract(): InvitationDTO {
    const { tokenHash: _, ...invitation } = this.toDTO()
    return invitation
  }
}
