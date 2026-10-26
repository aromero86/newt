import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import type { Cors } from './cors'
import { HttpRouter } from './http-router'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})

const serve = (router: HttpRouter) => {
  const server = Bun.serve({ port: 0, routes: router.routes(), fetch: () => new Response('frontend') })
  servers.push(server)
  return server
}

const ANY: Cors = { origin: '*', headers: ['authorization', 'content-type'], expose: ['mcp-session-id'] }
const PREFLIGHT = { method: 'OPTIONS', headers: { origin: 'https://inspector.test', 'access-control-request-method': 'POST' } }

describe('cors', () => {
  test('a router\'s routes answer the preflight, and say so in every answer, errors too', async () => {
    const router = new HttpRouter({ cors: ANY })
    router.get('/things', () => Response.json([]), { public: true })
    router.post('/things', () => Response.json({}, { status: 201 }))
    const server = serve(router)
    const url = new URL('/api/things', server.url)

    const preflight = await fetch(url, PREFLIGHT)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    expect(preflight.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
    expect(preflight.headers.get('access-control-max-age')).toBe('86400')

    const listed = await fetch(url, { headers: { origin: 'https://inspector.test' } })
    expect(listed.headers.get('access-control-allow-origin')).toBe('*')
    expect(listed.headers.get('access-control-expose-headers')).toBe('mcp-session-id')
    const refused = await fetch(url, { method: 'POST' })
    expect(refused.status).toBe(401)
    expect(refused.headers.get('access-control-allow-origin')).toBe('*')
    const notAllowed = await fetch(url, { method: 'DELETE' })
    expect(notAllowed.status).toBe(405)
    expect(notAllowed.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('only a route or a group that asks for it: OPTIONS is a 405 elsewhere', async () => {
    const router = new HttpRouter()
    router.post('/token', () => Response.redirect('https://elsewhere.test', 302), { public: true, cors: ANY })
    router.get('/authorize', () => new Response('page'), { public: true })
    const group = router.group('/open', (_request, next) => next(), { public: true, cors: ANY })
    group.get('/one', () => new Response('one'))
    const server = serve(router)

    expect((await fetch(new URL('/api/token', server.url), PREFLIGHT)).status).toBe(204)
    // A redirect's headers are fixed: it is answered as a copy that says it too.
    const redirect = await fetch(new URL('/api/token', server.url), { method: 'POST', redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('access-control-allow-origin')).toBe('*')
    expect((await fetch(new URL('/api/open/one', server.url), PREFLIGHT)).status).toBe(204)

    const closed = await fetch(new URL('/api/authorize', server.url), PREFLIGHT)
    expect(closed.status).toBe(405)
    expect((await fetch(new URL('/api/authorize', server.url))).headers.get('access-control-allow-origin')).toBeNull()
  })

  test('listed origins: the one that asks, if it is among them, and never another', async () => {
    const router = new HttpRouter({ public: true, cors: { origin: ['https://app.test'] } })
    router.get('/things', () => Response.json([]))
    const server = serve(router)
    const url = new URL('/api/things', server.url)

    const allowed = await fetch(url, { headers: { origin: 'https://app.test' } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.test')
    expect(allowed.headers.get('vary')).toBe('origin')
    const other = await fetch(url, { headers: { origin: 'https://evil.test' } })
    expect(other.status).toBe(200)
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://evil.test' } })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })
})
