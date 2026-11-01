import { TableRepository } from '@newt-kit/newt/repository'
import type { AuthBase } from '../../auth-base'
import { OauthClient, type OauthClientDTO } from './oauth-client'

export type OauthClientRow = OauthClientDTO & { version: number }

export class OauthClient_Repository extends TableRepository<OauthClient, OauthClientRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: the monitor has no tenants, and its clients are the one person's.
    super(base, base.store.table<OauthClientRow>('oauth_client', { types: { redirectUris: 'json' } }), { scope: 'none' })
  }

  protected toEntity(row: OauthClientRow): OauthClient {
    return OauthClient.fromDTO(row)
  }
}
