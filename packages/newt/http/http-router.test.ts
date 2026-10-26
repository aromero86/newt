import { describe, expect, test } from 'bun:test'
import { currentActor } from '../core'
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
      expect(await response.json()).toMatchObject({ code: 'route_not_found' })
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
      expect(await response.json()).toMatchObject({ code: 'not_signed_in' })
    } finally {
      await server.stop()
    }
  })

  test('a signed-in request runs as its actor', async () => {
    const router = new HttpRouter()
    router.authenticateWith(async request => (request.headers.get('x-test-user') ? { userId: request.headers.get('x-test-user')! } : null))
    router.get('/me', () => Response.json({ userId: currentActor().userId }))
    const server = serve(router)
    try {
      const response = await fetch(new URL('/api/me', server.url), { headers: { 'x-test-user': 'user-7' } })
      expect(await response.json()).toEqual({ userId: 'user-7' })
    } finally {
      await server.stop()
    }
  })

  test('a group runs its middleware around each route, after the session, with both params', async () => {
    const router = new HttpRouter()
    router.authenticateWith(async request => (request.headers.get('x-test-user') ? { userId: request.headers.get('x-test-user')! } : null))
    const workspaces = router.group('/workspaces/:workspaceId', async (request, next) => {
      if (request.params.workspaceId !== 'mine') return Response.json({ error: 'not yours' }, { status: 404 })
      const response = await next()
      response.headers.set('x-workspace', request.params.workspaceId)
      return response
    })
    workspaces.get('/things/:id', request => Response.json({ workspace: request.params.workspaceId, id: request.params.id, user: currentActor().userId }))
    const server = serve(router)
    try {
      const ok = await fetch(new URL('/api/workspaces/mine/things/7', server.url), { headers: { 'x-test-user': 'ana' } })
      expect(await ok.json()).toEqual({ workspace: 'mine', id: '7', user: 'ana' })
      expect(ok.headers.get('x-workspace')).toBe('mine')
      expect((await fetch(new URL('/api/workspaces/other/things/7', server.url), { headers: { 'x-test-user': 'ana' } })).status).toBe(404)
      expect((await fetch(new URL('/api/workspaces/mine/things/7', server.url))).status).toBe(401)
    } finally {
      await server.stop()
    }
  })
})
