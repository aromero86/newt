import type { MonitorConfig } from '../../config'
import type { AuthBase } from './auth-base'
import { OauthClient_Module } from './modules/oauth-client/oauth-client.module'
import { OauthGrant_Module } from './modules/oauth-grant/oauth-grant.module'
import { Session_Module } from './modules/session/session.module'
import { Token_Module } from './modules/token/token.module'
import { registerOauthServerMetadata } from './oauth-server-metadata'

/** The monitor's MCP server, the one resource its tokens open (RFC 8707). */
export const mcpResourceOf = (publicUrl: string) => `${publicUrl}/mcp`

/** How long tokens last: an hour of access, refreshed for 30 days unused. */
const TOKEN_LIFETIME = { accessMinutes: 60, refreshDays: 30 }

/** Every module of `auth`: who may sign in to the monitor and their sessions, and who they let in through OAuth. */
export function initializeModules(base: AuthBase, config: MonitorConfig) {
  const session = Session_Module.initialize(base, {
    ...config.admin,
    hours: config.sessionHours,
    secureCookie: new URL(config.publicUrl).protocol === 'https:',
  })
  const oauthClient = OauthClient_Module.initialize(base)
  const oauthGrant = OauthGrant_Module.initialize(base, { oauthClient }, { publicUrl: config.publicUrl, resource: mcpResourceOf(config.publicUrl) })
  const token = Token_Module.initialize(base, { oauthClient, oauthGrant }, TOKEN_LIFETIME)
  registerOauthServerMetadata(base.oauth, config.publicUrl)
  return { session, oauthClient, oauthGrant, token }
}

export type Auth_Modules = ReturnType<typeof initializeModules>
