import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config } from '../../config'
import { Auth_Context } from './auth.context'

let auth: Auth_Context
let server: Server<undefined>
let url: string
/** How far auth's clock is ahead of the real one: a test moves it instead of waiting. */
let ahead: number

beforeEach(async () => {
  const port = freePort()
  url = `http://localhost:${port}`
  ahead = 0
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port, publicUrl: url }, { mailer: { send: async () => {} } }, { now: () => new Date(Date.now() + ahead) })
  server = serve(auth.serving())
  auth.start()
})

afterEach(async () => {
  await server.stop()
  await auth.stop()
})

const MCP = `${config.auth.boardsPublicUrl}/mcp`
const CALLBACK = 'http://localhost:9999/callback'

/** A PKCE pair (RFC 7636): the verifier the client keeps, and the challenge it sends. */
function pkce() {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  return { verifier, challenge: new Bun.CryptoHasher('sha256').update(verifier).digest('base64url') }
}

const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
const token = (fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(new URL('/oauth/token', url), { ...form(fields), headers: { ...form(fields).headers, ...headers } })

/** An authorization request as a client sends the browser to it: the request's id in auth's UI. */
async function authorize(as: Browser, params: Record<string, string>): Promise<string> {
  const response = await as(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', code_challenge_method: 'S256', ...params })}`)
  expect(response.status).toBe(302)
  const location = response.headers.get('location')!
  expect(location).toStartWith(`${url}/authorize/`)
  return location.slice(`${url}/authorize/`.length)
}

/** An MCP client, registered: its client_id. */
async function register(): Promise<string> {
  const response = await fetch(new URL('/oauth/register', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })
  expect(response.status).toBe(201)
  return ((await response.json()) as { client_id: string }).client_id
}

/** Ana, signed in to auth in her browser, approving an MCP client's request: its code. */
async function codeFor(clientId: string, challenge: string, as = browser(url)) {
  const id = await authorize(as, { client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, state: 'xyz', resource: MCP })
  await as('/api/session/sign-up', { method: 'POST', json: { email: `ana${Bun.randomUUIDv7()}@cooper.test`, name: 'Ana', password: 'a long password' } })
  const approved = await as(`/api/authorizations/${id}/approve`, { method: 'POST' })
  const redirectTo = new URL(((await approved.json()) as { redirectTo: string }).redirectTo)
  expect(redirectTo.searchParams.get('state')).toBe('xyz')
  return redirectTo.searchParams.get('code')!
}

describe('the OAuth server', () => {
  test('says where everything is', async () => {
    const response = await fetch(new URL('/.well-known/oauth-authorization-server', url))
    expect(await response.json()).toMatchObject({
      issuer: url,
      authorization_endpoint: `${url}/oauth/authorize`,
      token_endpoint: `${url}/oauth/token`,
      registration_endpoint: `${url}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  test('registers a client, asks the person, and trades the code for tokens that verify, refresh and revoke', async () => {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const as = browser(url)

    // The client sends the browser to auth; auth's UI shows who asks, before anyone signs in.
    const id = await authorize(as, { client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, state: 'xyz', resource: MCP })
    expect(await (await as(`/api/authorizations/${id}`)).json()).toMatchObject({ clientName: 'Claude', product: { id: 'cooper', signUp: true }, firstParty: false, redirectHost: 'localhost:9999', open: true })
    expect((await as(`/api/authorizations/${id}/approve`, { method: 'POST' })).status).toBe(401)

    // The person signs up, and says yes: the browser goes back to the client with a code.
    const ana = (await (await as('/api/session/sign-up', { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password', productId: 'cooper' } })).json()) as { id: string }
    expect(await (await as('/api/session')).json()).toMatchObject({ id: ana.id })
    const { redirectTo } = (await (await as(`/api/authorizations/${id}/approve`, { method: 'POST' })).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')!
    expect(redirectTo).toStartWith(`${CALLBACK}?code=cooper_ac_`)

    const traded = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })
    expect(traded.status).toBe(200)
    const first = (await traded.json()) as { access_token: string, refresh_token: string, token_type: string, expires_in: number }
    expect(first).toMatchObject({ token_type: 'Bearer', expires_in: config.auth.oauth.accessMinutes * 60 })
    expect(await auth.modules.token.verify(first.access_token)).toMatchObject({ userId: ana.id, clientId, productId: 'cooper', resource: MCP })

    // A refresh replaces both tokens.
    const refreshed = (await (await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).json()) as { access_token: string, refresh_token: string }
    expect(await auth.modules.token.verify(first.access_token)).toBeNull()
    expect(await auth.modules.token.verify(refreshed.access_token)).toMatchObject({ userId: ana.id })

    // The client gives them back: they open nothing.
    expect((await fetch(new URL('/oauth/revoke', url), form({ token: refreshed.refresh_token, client_id: clientId }))).status).toBe(200)
    expect(await auth.modules.token.verify(refreshed.access_token)).toBeNull()
  })

  test('revokes the tokens of a refresh token brought again after it was replaced', async () => {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const code = await codeFor(clientId, challenge)
    const first = (await (await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })).json()) as { refresh_token: string }
    const second = (await (await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).json()) as { access_token: string }

    const replayed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })
    expect(replayed.status).toBe(400)
    expect(await replayed.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await auth.modules.token.verify(second.access_token)).toBeNull()
  })

  test('trades a code once: brought again, the tokens it gave are revoked, from a worker', async () => {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const code = await codeFor(clientId, challenge)
    const exchange = () => token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })

    const first = (await (await exchange()).json()) as { access_token: string }
    const again = await exchange()
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
    await auth.base.jobs.idle()
    expect(await auth.modules.token.verify(first.access_token)).toBeNull()
  })

  test('removes the requests and tokens that expired, but keeps a redeemed request, which tells a copied code', async () => {
    const grants = (status: string) => auth.base.store.table<{ id: string, version: number, status: string }>('oauth_grant').count({ status })
    const tokens = () => auth.base.store.table('token').count({})
    const clientId = await register()
    await authorize(browser(url), { client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkce().challenge, resource: MCP })
    const { verifier, challenge } = pkce()
    const code = await codeFor(clientId, challenge)
    expect((await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })).status).toBe(200)

    // Nothing has expired yet: nothing goes.
    expect(await auth.modules.oauthGrant.purgeExpired()).toBe(0)
    expect(await auth.modules.token.purgeExpired()).toBe(0)

    ahead = (config.auth.oauth.refreshDays + 1) * 24 * 60 * 60_000
    expect(await auth.modules.oauthGrant.purgeExpired()).toBe(1)
    expect(await auth.modules.token.purgeExpired()).toBe(1)

    expect(await grants('pending')).toBe(0)
    expect(await grants('redeemed')).toBe(1)
    expect(await tokens()).toBe(0)
  })

  test('refuses a code without its PKCE verifier, and a request it cannot answer', async () => {
    const clientId = await register()
    const { challenge } = pkce()
    const code = await codeFor(clientId, challenge)
    const wrong = await token({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: clientId, redirect_uri: CALLBACK })
    expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' })
    expect(await (await token({ grant_type: 'password', client_id: clientId })).json()).toMatchObject({ error: 'unsupported_grant_type' })

    // An unknown client, or no PKCE: auth's UI says why, and nothing goes back to the client.
    const unknown = await browser(url)(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'nope', redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' })}`)
    expect(unknown.headers.get('location')).toStartWith(`${url}/error?message=`)
    const plain = await browser(url)(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'plain' })}`)
    expect(new URL(plain.headers.get('location')!).searchParams.get('message')).toContain('PKCE')
    const elsewhere = await fetch(new URL('/oauth/register', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/callback'] }) })
    expect(await elsewhere.json()).toMatchObject({ error: 'invalid_client_metadata' })
  })

  test('answers a method its endpoints do not have in OAuth\'s format too', async () => {
    const response = await fetch(new URL('/oauth/token', url))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'invalid_request', error_description: 'GET is not allowed on /oauth/token' })
    const register = await fetch(new URL('/oauth/register', url), { method: 'DELETE' })
    expect(await register.json()).toMatchObject({ error: 'invalid_request' })
  })

  test('sends the browser back empty-handed when the person says no', async () => {
    const clientId = await register()
    const as = browser(url)
    const id = await authorize(as, { client_id: clientId, redirect_uri: CALLBACK, code_challenge: pkce().challenge, state: 'xyz', resource: MCP })
    await as('/api/session/sign-up', { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })

    const { redirectTo } = (await (await as(`/api/authorizations/${id}/deny`, { method: 'POST' })).json()) as { redirectTo: string }
    expect(Object.fromEntries(new URL(redirectTo).searchParams)).toEqual({ error: 'access_denied', state: 'xyz' })
    expect(await (await as(`/api/authorizations/${id}/approve`, { method: 'POST' })).json()).toMatchObject({ code: 'oauthGrant.not_open' })
  })

  test('signs out of auth on the way back to a product, and to no other address', async () => {
    const as = browser(url)
    await as('/api/session/sign-up', { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })
    expect((await as('/api/session')).status).toBe(200)

    const back = await as(`/oauth/logout?${new URLSearchParams({ redirect: `${config.auth.backofficePublicUrl}/workspaces` })}`)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe(`${config.auth.backofficePublicUrl}/workspaces`)
    expect((await as('/api/session')).status).toBe(401)

    for (const redirect of ['https://evil.test/', 'javascript:alert(1)', '//evil.test', '']) {
      expect((await as(`/oauth/logout?${new URLSearchParams({ redirect })}`)).headers.get('location')).toBe('/')
    }
  })

  test('signs the staff in to the backoffice, a confidential client, and nobody else', async () => {
    const redirectUri = `${config.auth.backofficePublicUrl}/api/session/callback`
    const { verifier, challenge } = pkce()
    const as = browser(url)
    const id = await authorize(as, { client_id: 'backoffice', redirect_uri: redirectUri, code_challenge: challenge })
    expect(await (await as(`/api/authorizations/${id}`)).json()).toMatchObject({ product: { id: 'backoffice', signUp: false }, firstParty: true, refused: null })

    const staff = await auth.modules.user.signUp({ email: 'staff@cooper.test', name: 'Staff', password: 'a long password' })
    await as('/api/session/sign-in', { method: 'POST', json: { email: 'staff@cooper.test', password: 'a long password' } })
    // Signed in, the review says upfront what approving would answer.
    expect(await (await as(`/api/authorizations/${id}`)).json()).toMatchObject({ refused: { code: 'oauthGrant.no_access' } })
    expect(await (await as(`/api/authorizations/${id}/approve`, { method: 'POST' })).json()).toMatchObject({ code: 'oauthGrant.no_access' })

    await auth.modules.access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })
    expect(await (await as(`/api/authorizations/${id}`)).json()).toMatchObject({ refused: null })
    const { redirectTo } = (await (await as(`/api/authorizations/${id}/approve`, { method: 'POST' })).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')!
    const exchange = (secret: string) => token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, { authorization: `Basic ${btoa(`backoffice:${secret}`)}` })

    const wrong = await exchange('not the secret of the backoffice')
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ error: 'invalid_client' })
    const tokens = (await (await exchange(config.auth.clientSecrets.backoffice)).json()) as { access_token: string }
    expect(await auth.modules.token.verify(tokens.access_token)).toMatchObject({ userId: staff.id, productId: 'backoffice', resource: null })
  })
})
