import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Invitation, type InvitationEntityDTO } from './invitation'

export type InvitationRow = InvitationEntityDTO & { version: number }

export class Invitation_Repository extends TableRepository<Invitation, InvitationRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<InvitationRow>('invitation'))
  }

  protected toEntity(row: InvitationRow): Invitation {
    return Invitation.fromDTO(row)
  }
}
