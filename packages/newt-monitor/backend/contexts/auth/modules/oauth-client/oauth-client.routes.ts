import { toOauthErrorResponse } from 'newt/http'
import { z } from 'zod'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors/cors'
import { REGISTER_LIMIT, REGISTRATION_MAX_BYTES } from '../../../../shared/rate-limits'
import type { AuthBase } from '../../auth-base'
import type { OauthClient_Module } from './oauth-client.module'

/**
 * What RFC 7591 calls the fields this route reads: an object, each field as it came.
 * The use case checks what they say.
 */
const RegistrationRequest = z.object({ client_name: z.unknown(), redirect_uris: z.unknown(), token_endpoint_auth_method: z.unknown() })

export function registerOauthClientRoutes(base: AuthBase, clients: OauthClient_Module): void {
  // Dynamic client registration (RFC 7591), for MCP clients. Public: whoever registers
  // is nobody to the monitor yet, so each address registers a few, and small. It speaks
  // OAuth's wire format, errors included.
  base.oauth.post('/oauth/register', async request => {
    const body = RegistrationRequest.parse(await request.json())
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return Response.json({ error: 'invalid_client_metadata', error_description: 'A registered client is public: its token_endpoint_auth_method is none' }, { status: 400, headers: { 'cache-control': 'no-store' } })
    }
    const client = await clients.register({
      name: typeof body.client_name === 'string' ? body.client_name : undefined,
      redirectUris: body.redirect_uris,
    })
    return Response.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      // Whatever the client asked for, this is what it is registered with.
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, { status: 201, headers: { 'cache-control': 'no-store' } })
  }, { cors: OPEN_TO_BROWSERS, rateLimit: REGISTER_LIMIT, maxBodyBytes: REGISTRATION_MAX_BYTES, onError: error => toOauthErrorResponse(error, 'invalid_client_metadata') })
}
