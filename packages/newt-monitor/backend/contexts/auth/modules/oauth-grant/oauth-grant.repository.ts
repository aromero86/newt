import { TableRepository } from '@newt-kit/newt/repository'
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

  /** Removes for good the grants never redeemed whose time was up by `at`: how many it removed. */
  purgeExpired(at: Date): Promise<number> {
    return this.purge({ status: { in: ['pending', 'approved', 'denied'] }, expiresAt: { lte: at.toISOString() } })
  }
}
