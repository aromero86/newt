import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { currentActor, NotFoundError } from '../core'
import { bearerAuthenticator } from './bearer-authenticator'
import { NotSignedIn } from './errors/not-signed-in'
import { HttpRouter } from './http-router'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})

const serve = (...routers: HttpRouter[]) => {
  const server = Bun.serve({ port: 0, routes: Object.assign({}, ...routers.map(router => router.routes())), fetch: () => new Response('frontend') })
  servers.push(server)
  return server
}

class ThingNotFound extends NotFoundError {
  readonly code = 'thing.not_found'
}

describe('HttpRouter at the root, with errors of its own', () => {
  test('at the root it takes its own paths only: the rest is the frontend\'s, /api too', async () => {
    const api = new HttpRouter()
    const root = new HttpRouter({ prefix: '' })
    root.get('/.well-known/thing', () => Response.json({ thing: true }), { public: true })
    root.post('/oauth/token', () => Response.json({ token: 't' }), { public: true })
    const server = serve(api, root)

    expect(await (await fetch(new URL('/.well-known/thing', server.url))).json()).toEqual({ thing: true })
    expect((await fetch(new URL('/oauth/token', server.url), { method: 'POST' })).status).toBe(200)
    expect((await fetch(new URL('/oauth/token', server.url))).status).toBe(405)
    expect(await (await fetch(new URL('/oauth/other', server.url))).text()).toBe('frontend')
    expect((await fetch(new URL('/api/other', server.url))).status).toBe(404)
  })

  test('onError: a route\'s over its group\'s over its router\'s, with the request it failed', async () => {
    const asText = (prefix: string) => (error: unknown, request: Request) =>
      new Response(`${prefix} ${(error as Error).constructor.name} ${new URL(request.url).pathname}`, { status: 400 })
    const router = new HttpRouter({ prefix: '', onError: asText('router') })
    router.get('/a', () => { throw new ThingNotFound('no') }, { public: true })
    router.get('/b', () => { throw new ThingNotFound('no') }, { public: true, onError: asText('route') })
    router.get('/c', () => new Response('c'))
    const group = router.group('/g', (_request, next) => next(), { public: true, onError: asText('group') })
    group.get('/d', () => { throw new ThingNotFound('no') })
    const server = serve(router)

    const text = async (path: string, method = 'GET') => (await fetch(new URL(path, server.url), { method })).text()
    expect(await text('/a')).toBe('router ThingNotFound /a')
    expect(await text('/b')).toBe('route ThingNotFound /b')
    expect(await text('/g/d')).toBe('group ThingNotFound /g/d')
    // A missing session and a method it does not have are its errors too.
    expect(await text('/c')).toBe('router NotSignedIn /c')
    expect(await text('/a', 'POST')).toBe('router MethodNotAllowed /a')
  })

  test('a method a path does not have answers through its routes\' onError, its Allow kept', async () => {
    const asText = (prefix: string) => (error: unknown) => new Response(`${prefix} ${(error as Error).constructor.name}`, { status: 405 })
    const router = new HttpRouter({ prefix: '' })
    router.post('/oauth/token', () => new Response('token'), { public: true, onError: asText('oauth') })
    const server = serve(router)

    for (const method of ['GET', 'DELETE', 'OPTIONS']) {
      const response = await fetch(new URL('/oauth/token', server.url), { method })
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect(await response.text()).toBe('oauth MethodNotAllowed')
    }
  })

  test('routes of one path that disagree on onError: its 405s are the first registered one\'s', async () => {
    const asText = (prefix: string) => (error: unknown) => new Response(`${prefix} ${(error as Error).constructor.name}`, { status: 405 })
    const router = new HttpRouter({ prefix: '', onError: asText('router') })
    router.put('/things/:id', () => new Response('put'), { public: true, onError: asText('first') })
    router.get('/things/:thingId', () => new Response('get'), { public: true, onError: asText('second') })
    router.patch('/other', () => new Response('patch'), { public: true })
    router.post('/other', () => new Response('post'), { public: true, onError: asText('own') })
    const server = serve(router)

    expect(await (await fetch(new URL('/things/1', server.url), { method: 'DELETE' })).text()).toBe('first MethodNotAllowed')
    // The first route took the router's: so do the path's 405s.
    expect(await (await fetch(new URL('/other', server.url))).text()).toBe('router MethodNotAllowed')
  })

  test('a path open to other origins still answers its preflight, and its 405s by its onError, with CORS', async () => {
    const router = new HttpRouter({ prefix: '' })
    router.post('/oauth/token', () => new Response('token'), {
      public: true,
      cors: { origin: '*' },
      onError: () => Response.json({ error: 'invalid_request' }, { status: 405 }),
    })
    const server = serve(router)
    const headers = { origin: 'https://elsewhere.test', 'access-control-request-method': 'POST' }

    const preflight = await fetch(new URL('/oauth/token', server.url), { method: 'OPTIONS', headers })
    expect(preflight.status).toBe(204)
    const notAllowed = await fetch(new URL('/oauth/token', server.url), { headers })
    expect(notAllowed.status).toBe(405)
    expect(notAllowed.headers.get('allow')).toBe('POST')
    expect(notAllowed.headers.get('access-control-allow-origin')).toBe('*')
    expect(await notAllowed.json()).toEqual({ error: 'invalid_request' })
  })

  test('without onError, an error is toErrorResponse\'s', async () => {
    const router = new HttpRouter()
    router.get('/things/:id', () => { throw new ThingNotFound('There is no such thing') }, { public: true })
    const server = serve(router)

    const response = await fetch(new URL('/api/things/1', server.url))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'There is no such thing', code: 'thing.not_found' })
  })
})

describe('bearerAuthenticator', () => {
  test('a valid bearer token signs the request in; none, or a wrong one, is nobody', async () => {
    const tokens: Record<string, string> = { 'good-token': 'user-1' }
    const router = new HttpRouter({ prefix: '' })
    const seen: string[] = []
    router.authenticateWith(bearerAuthenticator(async token => {
      seen.push(token)
      return tokens[token] ? { userId: tokens[token] } : null
    }))
    router.post('/mcp', async () => Response.json(currentActor()), {
      onError: (error, request) => error instanceof NotSignedIn
        ? new Response(null, { status: 401, headers: { 'www-authenticate': request.headers.has('authorization') ? 'Bearer error="invalid_token"' : 'Bearer' } })
        : new Response(null, { status: 500 }),
    })
    const server = serve(router)
    const call = (authorization?: string) => fetch(new URL('/mcp', server.url), { method: 'POST', headers: authorization ? { authorization } : {} })

    expect(await (await call('Bearer good-token')).json()).toEqual({ userId: 'user-1' })
    expect(await (await call('bearer  good-token')).json()).toEqual({ userId: 'user-1' })
    const missing = await call()
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect((await call('Bearer bad-token')).headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
    expect((await call('Basic dXNlcjpwYXNz')).status).toBe(401)
    expect(seen).toEqual(['good-token', 'good-token', 'bad-token'])
  })
})
