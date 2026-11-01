import { TableRepository } from '@newt-kit/newt/repository'
import type { AuthBase } from '../../auth-base'
import { OauthClient, type OauthClientEntityDTO } from './oauth-client'

export type OauthClientRow = OauthClientEntityDTO & { version: number }

export class OauthClient_Repository extends TableRepository<OauthClient, OauthClientRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: OAuth clients are auth's, in no tenant.
    super(base, base.store.table<OauthClientRow>('oauth_client', { types: { redirectUris: 'json' }, unique: [['clientId']] }), { scope: 'none' })
  }

  protected toEntity(row: OauthClientRow): OauthClient {
    return OauthClient.fromDTO(row)
  }
}
