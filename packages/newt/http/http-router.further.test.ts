import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { HttpRouter } from './http-router'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})

const serve = (router: HttpRouter) => {
  const server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response('frontend') })
  servers.push(server)
  return server
}

/** Each method answers with its own name, so a route wired to the wrong one shows. */
const own = (method: string) => () => Response.json({ method })

describe('HttpRouter, further', () => {
  test('keeps its routes, and its 404, under the prefix it is given', async () => {
    const router = new HttpRouter({ prefix: '/v1' })
    router.get('/things', own('GET'), { public: true })
    const server = serve(router)

    expect((await fetch(new URL('/v1/things', server.url))).status).toBe(200)
    expect((await fetch(new URL('/v1/nope', server.url))).status).toBe(404)
    expect(await (await fetch(new URL('/api/things', server.url))).text()).toBe('frontend')
  })

  test('routes each method to its own route', async () => {
    const router = new HttpRouter()
    router.get('/things', own('GET'), { public: true })
    router.post('/things', own('POST'), { public: true })
    router.put('/things', own('PUT'), { public: true })
    router.patch('/things', own('PATCH'), { public: true })
    router.delete('/things', own('DELETE'), { public: true })
    const server = serve(router)

    for (const method of METHODS) {
      expect(await (await fetch(new URL('/api/things', server.url), { method })).json()).toEqual({ method })
    }
  })

  test('every method a path does not have is a 405 that says so', async () => {
    const only = new HttpRouter()
    only.get('/things', own('GET'), { public: true })
    const server = serve(only)

    for (const method of METHODS.filter(method => method !== 'GET')) {
      const response = await fetch(new URL('/api/things', server.url), { method })
      expect(response.status).toBe(405)
      expect(await response.json()).toMatchObject({ code: 'method_not_allowed' })
    }
  })
})

describe('a body', () => {
  test('that is not JSON is the client\'s fault: a 400 that says so', async () => {
    const router = new HttpRouter()
    router.post('/things', async request => Response.json(await request.json()), { public: true })
    const server = serve(router)

    const bad = await fetch(new URL('/api/things', server.url), { method: 'POST', body: '{not json' })
    const good = await fetch(new URL('/api/things', server.url), { method: 'POST', body: '{"a":1}' })

    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'The body of the request is not valid JSON', code: 'malformed_body' })
    expect(await good.json()).toEqual({ a: 1 })
  })

  test('read twice is the route\'s mistake, not the client\'s: a 500', async () => {
    const router = new HttpRouter()
    router.post('/things', async request => Response.json([await request.json(), await request.json()]), { public: true })
    const server = serve(router)
    const original = console.error
    console.error = () => {}

    try {
      const response = await fetch(new URL('/api/things', server.url), { method: 'POST', body: '{"a":1}' })
      expect(response.status).toBe(500)
    } finally {
      console.error = original
    }
  })
})

describe('a group, further', () => {
  test('routes each method to its own route', async () => {
    const router = new HttpRouter()
    const group = router.group('/shops/:shopId', (_request, next) => next())
    group.get('/things', own('GET'), { public: true })
    group.post('/things', own('POST'), { public: true })
    group.put('/things', own('PUT'), { public: true })
    group.patch('/things', own('PATCH'), { public: true })
    group.delete('/things', own('DELETE'), { public: true })
    const server = serve(router)

    for (const method of METHODS) {
      expect(await (await fetch(new URL('/api/shops/s1/things', server.url), { method })).json()).toEqual({ method })
    }
  })

  test('a route of a group may be public, and runs its middleware all the same', async () => {
    const router = new HttpRouter()
    const ran: string[] = []
    router.group('/shops/:shopId', (request, next) => {
      ran.push(request.params.shopId)
      return next()
    }).get('/menu', () => Response.json({ ok: true }), { public: true })
    const server = serve(router)

    expect((await fetch(new URL('/api/shops/s1/menu', server.url))).status).toBe(200)
    expect(ran).toEqual(['s1'])
  })

  test('its middleware never runs for a request without a session', async () => {
    const router = new HttpRouter()
    const ran: string[] = []
    router.group('/shops/:shopId', (request, next) => {
      ran.push(request.params.shopId)
      return next()
    }).get('/orders', () => Response.json([]))
    const server = serve(router)

    expect((await fetch(new URL('/api/shops/s1/orders', server.url))).status).toBe(401)
    expect(ran).toEqual([])
  })
})
