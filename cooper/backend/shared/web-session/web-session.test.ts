import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Server } from 'bun'
import { SqliteStore } from 'newt/adapter-sqlite'
import { currentActor } from 'newt/core'
import { serve } from 'newt/http'
import { MemoryRateLimitStore } from 'newt/port-rate-limit'
import { browser, freePort } from 'newt/testing'
import { config } from '../../config'
import { Auth_Context } from '../../contexts/auth/auth.context'
import { CooperBase } from '../cooper-base'
import { ServedContext } from '../served-context'
import { ownPath, WebSession_Module } from './web-session.module'
import type { WebSessionRow } from './web-session.repository'

/**
 * A context that signs its people in through auth, as boards does: the product
 * `cooper`'s client, with the web-session module, its migration, and one route that
 * says who is asking.
 */
class Client_Context extends ServedContext {

  private constructor(base: CooperBase, readonly session: WebSession_Module, port: number) {
    super('client', base, { port, frontendFolder: config.boards.frontendFolder })
  }

  static async open(port: number, auth: Auth_Context): Promise<Client_Context> {
    const store = await SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations/sqlite') })
    // A client of its own, with no table for its rate limits: they count in its memory.
    const base = new CooperBase({ name: 'client', store, rateLimits: new MemoryRateLimitStore() })
    const session = WebSession_Module.initialize(base, {
      context: 'client',
      clientId: 'cooper',
      clientSecret: config.auth.clientSecrets.cooper,
      publicUrl: `http://localhost:${port}`,
      authUrl: auth.config.publicUrl,
      days: 1,
      identify: accessToken => auth.modules.token.verify(accessToken),
      profile: userId => auth.modules.user.get(userId),
    })
    base.http.get('/whoami', async () => Response.json(currentActor()))
    return new Client_Context(base, session, port)
  }
}

let auth: Auth_Context
let client: Client_Context
let servers: Server<undefined>[]

beforeEach(async () => {
  const [authPort, clientPort] = [freePort(), freePort()]
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: authPort, publicUrl: `http://localhost:${authPort}`, boardsPublicUrl: `http://localhost:${clientPort}` }, { mailer: { send: async () => {} } })
  client = await Client_Context.open(clientPort, auth)
  servers = [serve(auth.serving()), serve(client.serving())]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await client.stop()
  await auth.stop()
})

const authUrl = (path: string) => new URL(path, auth.config.publicUrl).toString()
const clientUrl = (path: string) => new URL(path, `http://localhost:${servers[1]!.port}`).toString()

/** From the client's sign-in to auth's UI: the browser, and the id of the request auth shows. */
async function startSignIn(returnTo = '/boards/1') {
  const as = browser()
  const started = await as(clientUrl(`/api/session/sign-in?returnTo=${encodeURIComponent(returnTo)}`))
  expect(started.status).toBe(302)
  const authorize = started.headers.get('location')!
  expect(authorize).toStartWith(authUrl('/oauth/authorize?'))
  const kept = await as(authorize)
  const id = kept.headers.get('location')!.split('/authorize/')[1]!
  return { as, id }
}

describe('the web session of a context', () => {
  test('signs the person in through auth, and keeps its own session', async () => {
    const { as, id } = await startSignIn()

    // In auth: who asks, the person signs up, and auth's UI says yes for a product's own client.
    expect(await (await as(authUrl(`/api/authorizations/${id}`))).json()).toMatchObject({ firstParty: true, product: { id: 'cooper' } })
    const ana = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password', productId: 'cooper' } })).json()) as { id: string }
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
    expect(redirectTo).toStartWith(clientUrl('/api/session/callback?code='))

    // Back in the client: the code is traded over HTTP, and the browser goes where it was going.
    const back = await as(redirectTo)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/boards/1')
    expect(await (await as(clientUrl('/api/session'))).json()).toMatchObject({ id: ana.id, email: 'ana@cooper.test' })
    expect(await (await as(clientUrl('/api/whoami'))).json()).toEqual({ userId: ana.id, via: 'web' })
    // It keeps no token: it gave them back once it knew who signed in.
    expect(await auth.base.store.table('token').count()).toBe(0)

    // The same callback again opens nothing: the sign-in it answered (its cookie) is over, so it
    // is told expired before its code goes to auth (which refuses a spent one: oauth.test.ts).
    expect(new URL((await as(redirectTo)).headers.get('location')!, clientUrl('/')).searchParams.get('signInError')).toBe('session.sign_in_expired')

    // Signing out goes on to auth, which ends its own session too and sends the browser back.
    const { next } = (await (await as(clientUrl('/api/session/sign-out'), { method: 'POST' })).json()) as { next: string }
    expect(next).toBe(authUrl(`/oauth/logout?${new URLSearchParams({ redirect: `http://localhost:${servers[1]!.port}` })}`))
    expect((await as(clientUrl('/api/session'))).status).toBe(401)
    expect((await as(clientUrl('/api/whoami'))).status).toBe(401)
    const loggedOut = await as(next)
    expect(loggedOut.headers.get('location')).toBe(clientUrl('/'))
    expect((await as(authUrl('/api/session'))).status).toBe(401)

    // Signing out on the way somewhere comes back there: a path of the client, never another host.
    const { next: toInvitation } = (await (await as(clientUrl('/api/session/sign-out?returnTo=/invitations/abc'), { method: 'POST' })).json()) as { next: string }
    expect((await as(toInvitation)).headers.get('location')).toBe(clientUrl('/invitations/abc'))
    const { next: elsewhere } = (await (await as(clientUrl(`/api/session/sign-out?returnTo=${encodeURIComponent('//evil.example/x')}`), { method: 'POST' })).json()) as { next: string }
    expect((await as(elsewhere)).headers.get('location')).toBe(clientUrl('/'))
  })

  test('refuses a callback that is not the answer to its own sign-in', async () => {
    const { as, id } = await startSignIn()
    await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }

    // Another browser, which never started this sign-in, cannot finish it.
    const stranger = await browser()(redirectTo)
    expect(stranger.headers.get('location')).toBe('/?signInError=session.sign_in_expired')
    const forged = new URL(redirectTo)
    forged.searchParams.set('state', 'not the state')
    expect((await as(forged.toString())).headers.get('location')).toBe('/?signInError=session.sign_in_expired')
  })

  test('says so when the person says no, and never sends the browser elsewhere', async () => {
    const { as, id } = await startSignIn('//evil.example/steal')
    await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' } })
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${id}/deny`), { method: 'POST' })).json()) as { redirectTo: string }
    expect((await as(redirectTo)).headers.get('location')).toBe('/?signInError=session.sign_in_denied')

    const again = await startSignIn('//evil.example/steal')
    await again.as(authUrl('/api/session/sign-in'), { method: 'POST', json: { email: 'ana@cooper.test', password: 'a long password' } })
    const approved = (await (await again.as(authUrl(`/api/authorizations/${again.id}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
    expect((await again.as(approved.redirectTo)).headers.get('location')).toBe('/')
  })

  test('removes every night the sessions that expired, and keeps the live ones', async () => {
    // A session whose browser never comes back: its cookie went as it expired.
    const sessions = client.base.store.table<WebSessionRow>('session')
    const row = { userId: Bun.randomUUIDv7(), createdAt: '', updatedAt: '' }
    await sessions.insert({ ...row, id: Bun.randomUUIDv7(), tokenHash: 'expired', expiresAt: new Date(Date.now() - 60_000).toISOString() })
    await sessions.insert({ ...row, id: Bun.randomUUIDv7(), tokenHash: 'live', expiresAt: new Date(Date.now() + 60_000).toISOString() })

    expect(await client.session.purgeExpired()).toBe(1)
    expect((await sessions.find()).map(session => session.tokenHash)).toEqual(['live'])
    expect(await client.session.purgeExpired()).toBe(0)
  })
})

describe('ownPath', () => {
  test('keeps a path of the context, and turns whatever a browser would read as another host into /', () => {
    expect(ownPath('/w/1/boards?x=1#a')).toBe('/w/1/boards?x=1#a')
    for (const elsewhere of ['//evil.example', '/\\evil.example', '/\t/evil.example/x', '/\n/evil.example', 'https://evil.example', undefined]) expect(ownPath(elsewhere)).toBe('/')
  })
})
