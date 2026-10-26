import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Server } from 'bun'
import { SqliteStore } from 'newt/adapter-sqlite'
import { currentActor } from 'newt/core'
import { config } from '../../config'
import { Auth_Context } from '../../contexts/auth/auth.context'
import { CooperBase } from '../cooper-base'
import { ServedContext } from '../served-context'
import { WebSession_Module } from './web-session.module'

/** A port nobody listens on now: each context must know the other's address before it opens. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  void probe.stop()
  return port
}

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
    const store = await SqliteStore.open({ path: ':memory:', migrations: join(import.meta.dir, 'migrations') })
    const base = new CooperBase({ name: 'client', store })
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
  auth = await Auth_Context.open({ ...config.auth, dbPath: ':memory:', port: authPort, publicUrl: `http://localhost:${authPort}`, boardsPublicUrl: `http://localhost:${clientPort}` }, { mailer: { send: async () => {} } })
  client = await Client_Context.open(clientPort, auth)
  servers = [auth.serve(), client.serve()]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await client.stop()
  await auth.stop()
})

/** A browser: it keeps each origin's cookies, and never follows a redirect on its own. */
function browser() {
  const jars = new Map<string, Map<string, string>>()
  return async (address: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init
    const target = new URL(address)
    const jar = jars.get(target.host) ?? new Map<string, string>()
    jars.set(target.host, jar)
    const response = await fetch(target, {
      ...rest,
      redirect: 'manual',
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
      body: json === undefined ? rest.body : JSON.stringify(json),
    })
    for (const each of response.headers.getSetCookie()) {
      const [pair, ...attributes] = each.split(';')
      const [name, value = ''] = pair!.split('=')
      const gone = value === '' || attributes.some(attribute => /max-age=0\b/i.test(attribute.trim()) || /expires=thu, 01 jan 1970/i.test(attribute.trim()))
      if (gone) jar.delete(name!.trim())
      else jar.set(name!.trim(), value)
    }
    return response
  }
}

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

    // The code was spent: the same callback again opens nothing.
    expect(new URL((await as(redirectTo)).headers.get('location')!, clientUrl('/')).searchParams.get('signInError')).toBe('session.sign_in_expired')

    expect((await as(clientUrl('/api/session/sign-out'), { method: 'POST' })).status).toBe(204)
    expect((await as(clientUrl('/api/session'))).status).toBe(401)
    expect((await as(clientUrl('/api/whoami'))).status).toBe(401)
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
})
