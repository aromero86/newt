import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { config, type Config } from '../../config'
import { openContexts, stopContexts } from '../../open-contexts'
import { PRODUCTS } from '../auth/modules/product/product.schema'

/** A port nobody listens on now: each context must know the other's address before it opens. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  void probe.stop()
  return port
}

/** A browser: it keeps each origin's cookies, and never follows a redirect on its own. */
function browser() {
  const jars = new Map<string, Map<string, string>>()
  return async (address: string, init: { method?: string, json?: unknown } = {}) => {
    const target = new URL(address)
    const jar = jars.get(target.host) ?? new Map<string, string>()
    jars.set(target.host, jar)
    const response = await fetch(target, {
      method: init.method,
      redirect: 'manual',
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), ...(init.json === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    })
    for (const each of response.headers.getSetCookie()) {
      const [pair, ...attributes] = each.split(';')
      const [name, value = ''] = pair!.split('=')
      const gone = value === '' || attributes.some(attribute => /max-age=0\b/i.test(attribute.trim()))
      if (gone) jar.delete(name!.trim())
      else jar.set(name!.trim(), value)
    }
    return response
  }
}

describe('signing in to the backoffice', () => {
  let contexts: Awaited<ReturnType<typeof openContexts>>
  let servers: Server<undefined>[]
  let authUrl: string
  let backofficeUrl: string

  beforeEach(async () => {
    const [authPort, backofficePort] = [freePort(), freePort()]
    authUrl = `http://localhost:${authPort}`
    backofficeUrl = `http://localhost:${backofficePort}`
    const testConfig: Config = {
      ...config,
      auth: { ...config.auth, dbPath: ':memory:', port: authPort, publicUrl: authUrl, backofficePublicUrl: backofficeUrl },
      boards: { ...config.boards, dbPath: ':memory:', port: 0 },
      backoffice: { ...config.backoffice, dbPath: ':memory:', port: backofficePort, publicUrl: backofficeUrl, authPublicUrl: authUrl },
      trace: false,
    }
    contexts = await openContexts(testConfig, { mailer: { send: async () => {} } })
    servers = [serve(contexts.auth.serving()), serve(contexts.backoffice.serving())]
  })

  afterEach(async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
  })

  /** Someone with an account signs in at auth, on their way to the backoffice, and says yes to it. */
  async function signIn(email: string) {
    const as = browser()
    const started = await as(`${backofficeUrl}/api/session/sign-in?returnTo=/staff`)
    const authorize = await as(started.headers.get('location')!)
    const id = authorize.headers.get('location')!.split('/authorize/')[1]!
    await as(`${authUrl}/api/session/sign-in`, { method: 'POST', json: { email, password: 'a long password' } })
    return { as, id, approved: await as(`${authUrl}/api/authorizations/${id}/approve`, { method: 'POST' }) }
  }

  /** Where auth sends the browser back to the backoffice. */
  const back = async (as: ReturnType<typeof browser>, answer: Response) => as(((await answer.json()) as { redirectTo: string }).redirectTo)

  test('lets the staff in, and refuses at auth whoever is not', async () => {
    const { user, access } = contexts.auth.modules
    const sam = await user.signUp({ email: 'sam@cooper.test', name: 'Sam', password: 'a long password' })
    await access.admit({ userId: sam.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
    await user.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })

    const staff = await signIn('sam@cooper.test')
    expect((await back(staff.as, staff.approved)).headers.get('location')).toBe('/staff')
    expect(await (await staff.as(`${backofficeUrl}/api/session`)).json()).toMatchObject({ user: { id: sam.id, email: 'sam@cooper.test' } })
    expect((await staff.as(`${backofficeUrl}/api/staff`)).status).toBe(200)

    // auth does not let her say yes: the backoffice lets in only whom it was told. She can only go back.
    const other = await signIn('ana@cooper.test')
    expect(other.approved.status).toBe(403)
    expect(await other.approved.json()).toMatchObject({ code: 'oauthGrant.no_access' })
    const denied = await other.as(`${authUrl}/api/authorizations/${other.id}/deny`, { method: 'POST' })
    expect((await back(other.as, denied)).headers.get('location')).toBe('/?signInError=session.sign_in_denied')
    expect((await other.as(`${backofficeUrl}/api/session`)).status).toBe(401)
  })
})
