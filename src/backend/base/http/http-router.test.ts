import { describe, expect, test } from 'bun:test'
import { currentActor } from '../../core/context/current-actor'
import { HttpRouter } from './http-router'

const serve = (router: HttpRouter) => Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response('frontend') })

describe('HttpRouter', () => {
  test('serves a registered route under /api', async () => {
    const router = new HttpRouter()
    router.get('/things/:id', request => Response.json({ id: request.params.id }), { public: true })
    const server = serve(router)
    try {
      expect(await (await fetch(new URL('/api/things/42', server.url))).json()).toEqual({ id: '42' })
    } finally {
      await server.stop()
    }
  })

  test('an unknown route under /api is a 404, never the frontend', async () => {
    const server = serve(new HttpRouter())
    try {
      const response = await fetch(new URL('/api/nope', server.url))
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'api.route_not_found' })
    } finally {
      await server.stop()
    }
  })

  test('a method the route does not have is a 405', async () => {
    const router = new HttpRouter()
    router.get('/things', () => Response.json([]))
    const server = serve(router)
    try {
      expect((await fetch(new URL('/api/things', server.url), { method: 'DELETE' })).status).toBe(405)
    } finally {
      await server.stop()
    }
  })

  test('refuses the same route twice', () => {
    const router = new HttpRouter()
    router.get('/things', () => Response.json([]))
    expect(() => router.get('/things', () => Response.json([]))).toThrow('registered twice')
  })

  test('a route needs a session unless it is public: a 401 without one', async () => {
    const router = new HttpRouter()
    router.get('/private', () => Response.json({ ok: true }))
    const server = serve(router)
    try {
      const response = await fetch(new URL('/api/private', server.url))
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'auth.not_signed_in' })
    } finally {
      await server.stop()
    }
  })

  test('a signed-in request runs as its actor', async () => {
    const router = new HttpRouter()
    router.authenticateWith(async request => (request.headers.get('x-test-user') ? { userId: request.headers.get('x-test-user')!, sessionId: 's' } : null))
    router.get('/me', () => Response.json({ userId: currentActor().userId }))
    const server = serve(router)
    try {
      const response = await fetch(new URL('/api/me', server.url), { headers: { 'x-test-user': 'user-7' } })
      expect(await response.json()).toEqual({ userId: 'user-7' })
    } finally {
      await server.stop()
    }
  })
})
