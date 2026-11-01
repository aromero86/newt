import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import type { Clock } from '../core'
import { MemoryRateLimitStore } from '../port-rate-limit'
import { clientIp } from './client-ip'
import type { HttpRateLimit } from './http-rate-limit'
import { HttpRouter } from './http-router'
import type { HttpRouterOptions } from './http-router-options'
import { serve } from './serve'

const MINUTE = 60_000
const servers: Server<undefined>[] = []
let time = Date.parse('2026-01-01T10:00:00.000Z')
const clock: Clock = { now: () => new Date(time) }

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  time = Date.parse('2026-01-01T10:00:00.000Z')
})

/** A router whose requests sign in as the `x-user` they send, if any. */
function routerWith(options: HttpRouterOptions = {}) {
  const router = new HttpRouter({ clock, ...options })
  router.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  return router
}

function served(router: HttpRouter, trustProxy?: number) {
  const server = serve({ port: 0, router, trustProxy })
  servers.push(server)
  return (path: string, init: RequestInit & { user?: string } = {}) =>
    fetch(new URL(`/api${path}`, server.url), { ...init, headers: { ...(init.user ? { 'x-user': init.user } : {}), ...init.headers as Record<string, string> } })
}

const ok = () => Response.json({ ok: true })
const statuses = async (calls: Promise<Response>[]) => (await Promise.all(calls)).map(response => response.status)
const inTurn = async (n: number, call: () => Promise<Response>) => {
  const answers: number[] = []
  for (let i = 0; i < n; i++) answers.push((await call()).status)
  return answers
}

describe('rate limits on routes', () => {
  test('a route past its limit is a 429 that says when to try again', async () => {
    const router = routerWith()
    router.get('/things', ok, { rateLimit: { name: 'things', limit: 2, windowMs: MINUTE } })
    const call = served(router)

    const first = await call('/things', { user: 'ana' })
    expect(first.headers.get('ratelimit-limit')).toBe('2')
    expect(first.headers.get('ratelimit-remaining')).toBe('1')
    expect((await call('/things', { user: 'ana' })).status).toBe(200)

    const refused = await call('/things', { user: 'ana' })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await refused.json()).toMatchObject({ code: 'too_many_requests' })
  })

  test('counts each signed-in person on their own', async () => {
    const router = routerWith()
    router.get('/things', ok, { rateLimit: { name: 'things', limit: 1, windowMs: MINUTE } })
    const call = served(router)

    expect(await inTurn(2, () => call('/things', { user: 'ana' }))).toEqual([200, 429])
    expect((await call('/things', { user: 'bea' })).status).toBe(200)
  })

  test('a router\'s limit is the whole router\'s: every route counts against it', async () => {
    const router = routerWith({ rateLimit: { name: 'api', limit: 3, windowMs: MINUTE } })
    router.get('/things', ok)
    router.get('/others', ok)
    router.post('/things', ok)
    const call = served(router)

    expect([(await call('/things', { user: 'ana' })).status, (await call('/others', { user: 'ana' })).status, (await call('/things', { user: 'ana', method: 'POST' })).status])
      .toEqual([200, 200, 200])
    expect((await call('/others', { user: 'ana' })).status).toBe(429)
  })

  test('limits add up: a route counts against its router\'s, its group\'s and its own, each its own count', async () => {
    const router = routerWith({ rateLimit: { name: 'api', limit: 10, windowMs: MINUTE } })
    const group = router.group('/boards/:boardId', (_request, next) => next(), { rateLimit: { name: 'boards', limit: 3, windowMs: MINUTE } })
    group.get('/cards', ok, { rateLimit: { name: 'cards', limit: 1, windowMs: MINUTE } })
    group.get('/columns', ok)
    const call = served(router)

    // Its own is the closest: one, then a 429, while the group's still lets the others through.
    expect(await inTurn(2, () => call('/boards/b1/cards', { user: 'ana' }))).toEqual([200, 429])
    expect(await inTurn(3, () => call('/boards/b1/columns', { user: 'ana' }))).toEqual([200, 200, 429])
  })

  test('a route with rateLimit: false leaves out those above it', async () => {
    const router = routerWith({ rateLimit: { name: 'api', limit: 1, windowMs: MINUTE } })
    const group = router.group('/admin', (_request, next) => next(), { rateLimit: { name: 'admin', limit: 1, windowMs: MINUTE } })
    router.get('/health-like', ok, { rateLimit: false })
    group.get('/free', ok, { rateLimit: false })
    group.get('/own', ok, { rateLimit: { name: 'own', limit: 5, windowMs: MINUTE } })
    const call = served(router)

    expect(await inTurn(3, () => call('/health-like', { user: 'ana' }))).toEqual([200, 200, 200])
    expect(await inTurn(3, () => call('/admin/free', { user: 'ana' }))).toEqual([200, 200, 200])
    // Not left out: its own adds to the router's and the group's, both of one.
    expect(await inTurn(2, () => call('/admin/own', { user: 'ana' }))).toEqual([200, 429])
  })

  test('the same limit given twice counts once', async () => {
    const api: HttpRateLimit = { name: 'api', limit: 2, windowMs: MINUTE }
    const router = routerWith({ rateLimit: api })
    router.get('/things', ok, { rateLimit: api })
    const call = served(router)

    expect(await inTurn(3, () => call('/things', { user: 'ana' }))).toEqual([200, 200, 429])
  })

  test('nobody signed in on a public route is counted by the address it came from', async () => {
    const router = routerWith()
    router.post('/sign-in', ok, { public: true, rateLimit: { name: 'signIn', limit: 2, windowMs: MINUTE } })
    const call = served(router)

    expect(await inTurn(3, () => call('/sign-in', { method: 'POST' }))).toEqual([200, 200, 429])
  })

  test('by ip counts the address even when someone is signed in', async () => {
    const router = routerWith()
    router.get('/things', ok, { rateLimit: { name: 'things', limit: 2, windowMs: MINUTE, by: 'ip' } })
    const call = served(router)

    expect([(await call('/things', { user: 'ana' })).status, (await call('/things', { user: 'bea' })).status, (await call('/things', { user: 'cris' })).status]).toEqual([200, 200, 429])
  })

  test('a key of the route\'s own counts by it, and none leaves the request out', async () => {
    const router = routerWith()
    router.post('/sign-in', ok, { public: true, rateLimit: { name: 'signIn', limit: 1, windowMs: MINUTE, by: request => request.headers.get('x-email') } })
    const call = served(router)

    expect((await call('/sign-in', { method: 'POST', headers: { 'x-email': 'ana@example.com' } })).status).toBe(200)
    expect((await call('/sign-in', { method: 'POST', headers: { 'x-email': 'ana@example.com' } })).status).toBe(429)
    expect((await call('/sign-in', { method: 'POST', headers: { 'x-email': 'bea@example.com' } })).status).toBe(200)
    expect(await inTurn(3, () => call('/sign-in', { method: 'POST' }))).toEqual([200, 200, 200])
  })

  test('counts by the router\'s clock: once the window slides away, it may again', async () => {
    const router = routerWith()
    router.get('/things', ok, { rateLimit: { name: 'things', limit: 1, windowMs: MINUTE } })
    const call = served(router)
    await call('/things', { user: 'ana' })
    const refused = await call('/things', { user: 'ana' })

    time += Number(refused.headers.get('retry-after')) * 1000
    expect((await call('/things', { user: 'ana' })).status).toBe(200)
  })

  test('routers sharing a store share the counts of a name, as instances behind a balancer do', async () => {
    const store = new MemoryRateLimitStore()
    const calls = [routerWith({ rateLimits: store }), routerWith({ rateLimits: store })].map(router => {
      router.get('/things', ok, { rateLimit: { name: 'things', limit: 2, windowMs: MINUTE } })
      return served(router)
    })

    expect(await statuses([calls[0]!('/things', { user: 'ana' })])).toEqual([200])
    expect(await statuses([calls[1]!('/things', { user: 'ana' })])).toEqual([200])
    expect((await calls[0]!('/things', { user: 'ana' })).status).toBe(429)
  })

  test('a 429 answers through the route\'s onError', async () => {
    const router = routerWith({ onError: error => Response.json({ mine: true, status: (error as { status: number }).status }, { status: 429 }) })
    router.get('/things', ok, { rateLimit: { name: 'things', limit: 1, windowMs: MINUTE } })
    const call = served(router)
    await call('/things', { user: 'ana' })

    expect(await (await call('/things', { user: 'ana' })).json()).toEqual({ mine: true, status: 429 })
  })
})

describe('clientIp', () => {
  function echoing(trustProxy?: number) {
    const router = new HttpRouter()
    router.get('/ip', request => Response.json({ ip: clientIp(request) }), { public: true })
    return served(router, trustProxy)
  }
  const ipOf = async (call: ReturnType<typeof served>, forwarded?: string) =>
    (await (await call('/ip', { headers: forwarded ? { 'x-forwarded-for': forwarded } : {} })).json() as { ip: string }).ip

  test('is the socket\'s address, whatever X-Forwarded-For says, unless serve trusts a proxy', async () => {
    const call = echoing()

    expect(await ipOf(call)).toMatch(/127\.0\.0\.1|::1/)
    expect(await ipOf(call, '203.0.113.9')).toMatch(/127\.0\.0\.1|::1/)
  })

  test('behind trusted proxies is the one the first of them saw, never what the client wrote before it', async () => {
    const one = echoing(1)
    expect(await ipOf(one, '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipOf(one, '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9')

    const two = echoing(2)
    expect(await ipOf(two, '6.6.6.6, 203.0.113.9, 10.0.0.2')).toBe('203.0.113.9')
    // Fewer entries than proxies: the first one there is.
    expect(await ipOf(two, '203.0.113.9')).toBe('203.0.113.9')
  })

  test('is null for a request serve did not take', () => {
    expect(clientIp(new Request('http://localhost/'))).toBeNull()
  })
})
