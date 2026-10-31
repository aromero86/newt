import type { BunRequest } from 'bun'
import { toOauthErrorResponse, type RouteOptions } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors/cors'
import type { AuthBase } from '../../auth-base'
import { InvalidClient } from '../oauth-client/errors/invalid-client'
import type { Token_Module } from './token.module'

/** The OAuth error of each of the errors these endpoints may meet. */
const OAUTH_ERRORS = {
  'oauthClient.invalid_client': 'invalid_client',
  'oauthGrant.invalid_grant': 'invalid_grant',
  'token.invalid_grant': 'invalid_grant',
}

const NO_STORE = { 'cache-control': 'no-store' }

/** Open to clients in a browser, and failing in OAuth's wire format. */
const TOKEN_ENDPOINT: RouteOptions = {
  cors: OPEN_TO_BROWSERS,
  onError: error => toOauthErrorResponse(error, 'invalid_request', OAUTH_ERRORS),
}

/**
 * A request to the token endpoints: a form (RFC 6749 §3.2), and the client's
 * `client_id` in it; a secret, in the form or in its `Authorization` header, is read
 * only for the client to be refused, every client being public.
 */
async function formOf(request: BunRequest) {
  const form = new URLSearchParams(await request.text())
  const field = (name: string) => form.get(name) ?? undefined
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1]
  if (!basic) return { field, clientId: field('client_id') ?? '', clientSecret: field('client_secret') }
  // The id ends at the first colon: the secret may have more (RFC 6749 §2.3.1).
  const credentials = Buffer.from(basic, 'base64').toString()
  const colon = credentials.indexOf(':')
  const [id, secret] = colon === -1 ? [credentials, ''] : [credentials.slice(0, colon), credentials.slice(colon + 1)]
  try {
    return { field, clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) }
  } catch {
    throw new InvalidClient()
  }
}

export function registerTokenRoutes(base: AuthBase, tokens: Token_Module): void {
  // The token endpoint (RFC 6749 §3.2). Public: the client proves itself with its
  // PKCE verifier. OAuth's wire format, errors included.
  base.oauth.post('/oauth/token', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    const grantType = field('grant_type')
    const pair = grantType === 'authorization_code'
      ? await tokens.exchange({ clientId, clientSecret, code: field('code') ?? '', codeVerifier: field('code_verifier') ?? '', redirectUri: field('redirect_uri') ?? '' })
      : grantType === 'refresh_token'
        ? await tokens.refresh({ clientId, clientSecret, refreshToken: field('refresh_token') ?? '' })
        : null
    if (!pair) return Response.json({ error: 'unsupported_grant_type', error_description: 'The monitor gives tokens for a code or a refresh token' }, { status: 400, headers: NO_STORE })
    return Response.json({ access_token: pair.accessToken, token_type: 'Bearer', expires_in: pair.expiresIn, refresh_token: pair.refreshToken }, { headers: NO_STORE })
  }, TOKEN_ENDPOINT)

  // Token revocation (RFC 7009): a 200 whether the token was one or not.
  base.oauth.post('/oauth/revoke', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    await tokens.revoke({ clientId, clientSecret, token: field('token') ?? '' })
    return new Response(null, { status: 200, headers: NO_STORE })
  }, TOKEN_ENDPOINT)
}
