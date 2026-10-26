import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
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
}
