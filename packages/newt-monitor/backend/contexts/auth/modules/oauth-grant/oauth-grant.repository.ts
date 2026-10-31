import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { OauthGrant, type OauthGrantEntityDTO } from './oauth-grant'

export type OauthGrantRow = OauthGrantEntityDTO & { version: number }

export class OauthGrant_Repository extends TableRepository<OauthGrant, OauthGrantRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: a grant is the person's to a client, found by its code; the monitor has no tenants.
    super(base, base.store.table<OauthGrantRow>('oauth_grant'), { scope: 'none' })
  }

  protected toEntity(row: OauthGrantRow): OauthGrant {
    return OauthGrant.fromDTO(row)
  }
}
