import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { OauthGrant, type OauthGrantEntityDTO } from './oauth-grant'

export type OauthGrantRow = OauthGrantEntityDTO & { version: number }

export class OauthGrant_Repository extends TableRepository<OauthGrant, OauthGrantRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<OauthGrantRow>('oauth_grant', { types: { firstParty: 'boolean' } }))
  }

  protected toEntity(row: OauthGrantRow): OauthGrant {
    return OauthGrant.fromDTO(row)
  }
}
