import type { BunRequest } from 'bun'
import { toOauthErrorResponse, type RouteOptions } from 'newt-kit/http'
import { OPEN_TO_BROWSERS } from '../../../../shared/cors'
import type { AuthBase } from '../../auth-base'
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
 * credentials in its `Authorization` header (`client_secret_basic`) or in the form
 * (`client_secret_post`, or a public client's bare `client_id`).
 */
async function formOf(request: BunRequest) {
  const form = new URLSearchParams(await request.text())
  const field = (name: string) => form.get(name) ?? undefined
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1]
  if (!basic) return { field, clientId: field('client_id') ?? '', clientSecret: field('client_secret') }
  const [id = '', secret = ''] = Buffer.from(basic, 'base64').toString().split(':')
  return { field, clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) }
}

export function registerTokenRoutes(base: AuthBase, tokens: Token_Module): void {
  // The token endpoint (RFC 6749 §3.2). Public: the client proves itself with its
  // secret or its PKCE verifier. OAuth's wire format, errors included.
  base.oauth.post('/oauth/token', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    const grantType = field('grant_type')
    const pair = grantType === 'authorization_code'
      ? await tokens.exchange({ clientId, clientSecret, code: field('code') ?? '', codeVerifier: field('code_verifier') ?? '', redirectUri: field('redirect_uri') ?? '' })
      : grantType === 'refresh_token'
        ? await tokens.refresh({ clientId, clientSecret, refreshToken: field('refresh_token') ?? '' })
        : null
    if (!pair) return Response.json({ error: 'unsupported_grant_type', error_description: 'cooper gives tokens for a code or a refresh token' }, { status: 400, headers: NO_STORE })
    return Response.json({ access_token: pair.accessToken, token_type: 'Bearer', expires_in: pair.expiresIn, refresh_token: pair.refreshToken }, { headers: NO_STORE })
  }, TOKEN_ENDPOINT)

  // Token revocation (RFC 7009): a 200 whether the token was one or not.
  base.oauth.post('/oauth/revoke', async request => {
    const { field, clientId, clientSecret } = await formOf(request)
    await tokens.revoke({ clientId, clientSecret, token: field('token') ?? '' })
    return new Response(null, { status: 200, headers: NO_STORE })
  }, TOKEN_ENDPOINT)
}
