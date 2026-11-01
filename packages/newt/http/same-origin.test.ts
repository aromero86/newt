import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { HttpRouter } from './http-router'
import { serve } from './serve'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

const ok = () => new Response(null, { status: 204 })

function served() {
  const router = new HttpRouter()
  router.authenticateWith(async request => (request.headers.get('cookie') === 'session=ana' ? { userId: 'ana' } : null))
  router.post('/cards', ok)
  router.get('/cards', () => Response.json([]))
  router.delete('/cards/:id', ok)
  router.post('/sign-in', ok, { public: true })
  router.post('/token', ok, { public: true, cors: { origin: ['https://inspector.test'] } })
  router.post('/callback', ok, { public: true, crossOrigin: true })
  const server = serve({ port: 0, router })
  servers.push(server)
  return (method: string, path: string, headers: Record<string, string> = {}) =>
    fetch(new URL(`/api${path}`, server.url), { method, headers: { cookie: 'session=ana', ...headers } })
}

const SITE = (site: string) => ({ 'sec-fetch-site': site })

describe('writes from other origins', () => {
  test('a write a page of another site sends is a 403, signed in or not', async () => {
    const call = served()

    for (const site of ['cross-site', 'same-site']) {
      const refused = await call('POST', '/cards', SITE(site))
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ code: 'cross_origin_refused' })
      expect((await call('DELETE', '/cards/1', SITE(site))).status).toBe(403)
      expect((await call('POST', '/sign-in', SITE(site))).status).toBe(403)
    }
  })

  test('its own pages write, and so does the person by hand', async () => {
    const call = served()

    expect((await call('POST', '/cards', SITE('same-origin'))).status).toBe(204)
    expect((await call('POST', '/cards', SITE('none'))).status).toBe(204)
  })

  test('a read goes through from anywhere: only writes act', async () => {
    expect((await served()('GET', '/cards', SITE('cross-site'))).status).toBe(200)
  })

  test('a request from no page (a server, a script) goes through', async () => {
    expect((await served()('POST', '/cards')).status).toBe(204)
  })

  test('without Sec-Fetch-Site, an older browser\'s Origin decides: its own host, or a 403', async () => {
    const call = served()
    const host = new URL(servers[0]!.url).host

    expect((await call('POST', '/cards', { origin: `http://${host}` })).status).toBe(204)
    expect((await call('POST', '/cards', { origin: 'https://evil.test' })).status).toBe(403)
    expect((await call('POST', '/cards', { origin: 'null' })).status).toBe(403)
  })

  test('a route whose cors names the origin takes its writes; any other origin is still refused', async () => {
    const call = served()

    expect((await call('POST', '/token', { ...SITE('cross-site'), origin: 'https://inspector.test' })).status).toBe(204)
    expect((await call('POST', '/token', { ...SITE('cross-site'), origin: 'https://evil.test' })).status).toBe(403)
  })

  test('crossOrigin: true takes them all, for a form another site posts back on purpose', async () => {
    expect((await served()('POST', '/callback', { ...SITE('cross-site'), origin: 'https://payments.test' })).status).toBe(204)
  })
})
