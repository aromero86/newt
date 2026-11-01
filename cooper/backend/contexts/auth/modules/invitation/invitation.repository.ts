import { now, type Criteria, type Email } from 'newt-kit/core'
import { TableRepository } from 'newt-kit/repository'
import type { AuthBase } from '../../auth-base'
import { AlreadyInvited } from './errors/already-invited'
import { Invitation, type InvitationEntityDTO } from './invitation'

export type InvitationRow = InvitationEntityDTO & { version: number }

export class Invitation_Repository extends TableRepository<Invitation, InvitationRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: an invitation is found by its token before anyone is in its tenant; the use cases ask who is its admin.
    super(base, base.store.table<InvitationRow>('invitation'), { scope: 'none' })
  }

  protected toEntity(row: InvitationRow): Invitation {
    return Invitation.fromDTO(row)
  }

  /** A workspace's invitations still open, as `isOpen` says: pending and not expired. Of one email, if given. */
  open(tenantId: string, email?: Email): Criteria<InvitationRow> {
    return { tenantId, ...(email === undefined ? {} : { email }), status: 'pending', expiresAt: { gt: now().toISOString() } }
  }

  /**
   * Saves a new invitation only if its email has no other one open in its workspace:
   * checked after the write, in its transaction, guarding that email in that workspace,
   * so two invitations made at once cannot both be saved. One expired counts no more.
   */
  async persistOnlyOpenOne(invitation: Invitation): Promise<void> {
    await this.save([invitation], each => this.write(each), {
      guard: [`invitation:${invitation.tenantId}:${invitation.email}`],
      after: async () => {
        if (await this.count(this.open(invitation.tenantId, invitation.email)) > 1) throw new AlreadyInvited(invitation.email)
      },
    })
  }
}
