import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browser, freePort, type Browser } from 'newt/testing'
import { openTestMonitor, TEST_ADMIN, type TestMonitor } from '../../../../testing/open-test-monitor'

let monitor: TestMonitor
let time: number
const clock = { now: () => new Date(time) }

beforeEach(async () => {
  time = Date.parse('2026-01-01T09:00:00Z')
  monitor = await openTestMonitor({ clock, sessionHours: 1 })
})

afterEach(() => monitor.close())

describe('session', () => {
  test('signs the admin in, and every route runs as them', async () => {
    const as = await monitor.signedIn()

    expect(await (await as('/api/session')).json()).toEqual({ user: 'ana' })
  })

  test('keeps the token in a cookie the page cannot read, sent to this origin only', async () => {
    const response = await monitor.fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(TEST_ADMIN) })

    const cookie = response.headers.getSetCookie()[0]!
    expect(cookie).toStartWith('newt_monitor_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
  })

  test('refuses a wrong user or a wrong password the same way, saying neither', async () => {
    const as = browser(monitor.url)

    for (const json of [{ ...TEST_ADMIN, user: 'bea' }, { ...TEST_ADMIN, password: 'not the password' }]) {
      const response = await as('/api/session', { method: 'POST', json })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'session.wrong_credentials' })
    }
    expect((await as('/api/session')).status).toBe(401)
  })

  test('answers a 401 to anyone with no session, or one signed out', async () => {
    expect((await monitor.fetch('/api/session')).status).toBe(401)

    const as = await monitor.signedIn()
    expect((await as('/api/session', { method: 'DELETE' })).status).toBe(204)
    expect((await as('/api/session')).status).toBe(401)
    // Signing out twice is signing out once.
    expect((await as('/api/session', { method: 'DELETE' })).status).toBe(204)
  })

  test('lets one address guess ten times in a quarter of an hour, the right password included, until they are behind it', async () => {
    const as = browser(monitor.url)
    for (let guess = 0; guess < 10; guess++) expect((await as('/api/session', { method: 'POST', json: { ...TEST_ADMIN, password: `guess number ${guess}` } })).status).toBe(401)

    const refused = await as('/api/session', { method: 'POST', json: TEST_ADMIN })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)

    // The window slides: the guesses of the quarter before still weigh, those of two before no longer.
    time += 30 * 60_000
    expect((await as('/api/session', { method: 'POST', json: TEST_ADMIN })).status).toBe(200)
  })

  test('ends once its hours are up', async () => {
    const as = await monitor.signedIn()

    time += 59 * 60_000
    expect((await as('/api/session')).status).toBe(200)
    time += 60_000
    expect((await as('/api/session')).status).toBe(401)
  })
})

describe('every night', () => {
  const CALLBACK = 'http://localhost:6274/oauth/callback'
  const VERIFIER = 'v'.repeat(43)
  const challenge = new Bun.CryptoHasher('sha256').update(VERIFIER).digest('base64url')

  /** A request of `clientId` waiting for the person's answer: its id. */
  async function ask(as: Browser, clientId: string): Promise<string> {
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' })
    return (await as(`/oauth/authorize?${query}`)).headers.get('location')!.split('/authorize/')[1]!
  }

  /** A request approved and its code traded for tokens. */
  async function connect(as: Browser, clientId: string): Promise<void> {
    const { redirectTo } = (await (await as(`/api/authorizations/${await ask(as, clientId)}/approve`, { method: 'POST' })).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')!
    const tokens = await monitor.fetch('/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK }) })
    expect(tokens.status).toBe(200)
  }

  const rows = (table: string) => monitor.auth.base.store.table<{ id: string, version: number, status?: string }>(table).find()

  test('removes the sessions, requests and tokens past their time, and keeps the live ones and the codes traded', async () => {
    const registered = await monitor.fetch('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })
    const { client_id: clientId } = (await registered.json()) as { client_id: string }

    // A month ago: a session, a request never answered, one denied, and tokens whose refresh runs out.
    const before = await monitor.signedIn()
    await ask(before, clientId)
    await before(`/api/authorizations/${await ask(before, clientId)}/deny`, { method: 'POST' })
    await connect(before, clientId)

    // Just before three: a session, a request waiting, and tokens, all in time.
    time = Date.parse('2026-02-01T02:55:00Z')
    const now = await monitor.signedIn()
    await ask(now, clientId)
    await connect(now, clientId)
    expect(await rows('session')).toHaveLength(2)
    expect(await rows('oauth_grant')).toHaveLength(5)
    expect(await rows('token')).toHaveLength(2)

    time = Date.parse('2026-02-01T03:01:00Z')
    await monitor.auth.base.schedules.tick()
    await monitor.auth.base.jobs.idle()

    expect(await rows('session')).toHaveLength(1)
    expect((await rows('oauth_grant')).map(grant => grant.status).toSorted()).toEqual(['pending', 'redeemed', 'redeemed'])
    expect(await rows('token')).toHaveLength(1)
    expect((await now('/api/session')).status).toBe(200)
  })
})

describe('started with another password', () => {
  let folder: string

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'monitor-credentials-'))
  })

  afterEach(() => rm(folder, { recursive: true, force: true }))

  test('ends every session and revokes every token the old one opened; with the same one, none', async () => {
    await monitor.close()
    // On files, and the same port each time: the browser keeps its cookie for it.
    const files = { port: freePort(), database: join(folder, 'monitor.db'), authDatabase: join(folder, 'monitor-auth.db'), metricsFolder: join(folder, 'metrics') }
    const CALLBACK = 'http://localhost:6274/oauth/callback'
    const VERIFIER = 'v'.repeat(43)
    const challenge = new Bun.CryptoHasher('sha256').update(VERIFIER).digest('base64url')

    monitor = await openTestMonitor({ clock, ...files })
    const as = await monitor.signedIn()
    const { client_id: clientId } = (await (await monitor.fetch('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).json()) as { client_id: string }
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' })
    const request = (await as(`/oauth/authorize?${query}`)).headers.get('location')!.split('/authorize/')[1]!
    const { redirectTo } = (await (await as(`/api/authorizations/${request}/approve`, { method: 'POST' })).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')!
    const tokens = (await (await monitor.fetch('/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK }) })).json()) as { access_token: string }
    await monitor.close()

    // The same user and password: everything goes on.
    monitor = await openTestMonitor({ clock, ...files })
    expect((await as('/api/session')).status).toBe(200)
    expect(await monitor.auth.modules.token.verify(tokens.access_token)).not.toBeNull()
    await monitor.close()

    // Another password: nothing the old one opened does.
    monitor = await openTestMonitor({ clock, ...files, admin: { ...TEST_ADMIN, password: 'another password, as long' } })
    expect((await as('/api/session')).status).toBe(401)
    expect(await monitor.auth.modules.token.verify(tokens.access_token)).toBeNull()
  })
})
