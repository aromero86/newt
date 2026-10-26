import type { OauthClient_Module } from '../oauth-client/oauth-client.module'
import type { OauthGrant_Module } from '../oauth-grant/oauth-grant.module'

export interface Token_Deps {
  oauthClient: OauthClient_Module
  oauthGrant: OauthGrant_Module
}
