import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { OauthClient, type OauthClientEntityDTO } from './oauth-client'

export type OauthClientRow = OauthClientEntityDTO & { version: number }

export class OauthClient_Repository extends TableRepository<OauthClient, OauthClientRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<OauthClientRow>('oauth_client', { types: { redirectUris: 'json' }, unique: [['clientId']] }))
  }

  protected toEntity(row: OauthClientRow): OauthClient {
    return OauthClient.fromDTO(row)
  }
}
