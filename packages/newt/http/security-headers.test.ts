import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpRouter } from './http-router'
import { serve } from './serve'
import type { ServeOptions } from './serve-options'

let folder: string
const servers: Server<undefined>[] = []

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'newt-security-headers-'))
  await Bun.write(join(folder, 'index.html'), '<!doctype html><title>app</title>')
})

afterAll(() => rm(folder, { recursive: true }))

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

function served(options: Partial<ServeOptions> = {}) {
  const router = new HttpRouter()
  router.get('/things', () => Response.json([]), { public: true })
  router.get('/cached', () => Response.json([], { headers: { 'cache-control': 'max-age=60', 'referrer-policy': 'no-referrer' } }), { public: true })
  router.get('/away', () => Response.redirect('https://elsewhere.test/', 302), { public: true })
  const server = serve({ port: 0, router, frontend: folder, health: true, routes: { '/webhook': { POST: () => new Response('ok') } }, ...options })
  servers.push(server)
  return (path: string, init?: RequestInit) => fetch(new URL(path, server.url), { redirect: 'manual', ...init })
}

const NEWT = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY' }
const headersOf = (response: Response, names: string[]) => Object.fromEntries(names.map(name => [name, response.headers.get(name)]))

describe('security headers', () => {
  test('every answer carries them: the API\'s, its errors, its health, the routes beside it and the frontend', async () => {
    const call = served()

    for (const answer of [await call('/api/things'), await call('/api/nothing'), await call('/api/health'), await call('/webhook', { method: 'POST' }), await call('/'), await call('/anywhere')]) {
      expect(headersOf(answer, Object.keys(NEWT))).toEqual(NEWT)
    }
  })

  test('a redirect carries them too', async () => {
    const away = await served()('/api/away')

    expect(away.status).toBe(302)
    expect(away.headers.get('location')).toBe('https://elsewhere.test/')
    expect(away.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('an answer\'s own come first', async () => {
    expect((await served()('/api/cached')).headers.get('referrer-policy')).toBe('no-referrer')
  })

  test('the API\'s answers are kept by no cache, unless their route says otherwise; the frontend\'s may be', async () => {
    const call = served()

    expect((await call('/api/things')).headers.get('cache-control')).toBe('no-store')
    expect((await call('/api/nothing')).headers.get('cache-control')).toBe('no-store')
    expect((await call('/api/cached')).headers.get('cache-control')).toBe('max-age=60')
    expect((await call('/')).headers.get('cache-control')).toBeNull()
  })

  test('each one given replaces newt\'s, and null leaves it out', async () => {
    const answer = await served({ securityHeaders: { 'referrer-policy': 'no-referrer', 'x-frame-options': null, 'permissions-policy': 'camera=()' } })('/api/things')

    expect(headersOf(answer, ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy']))
      .toEqual({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': null, 'permissions-policy': 'camera=()' })
  })

  test('false sends none of them', async () => {
    const answer = await served({ securityHeaders: false })('/api/things')

    expect(headersOf(answer, Object.keys(NEWT))).toEqual({ 'x-content-type-options': null, 'referrer-policy': null, 'x-frame-options': null })
  })

  test('HSTS only when asked: a year unless told', async () => {
    expect((await served()('/api/things')).headers.get('strict-transport-security')).toBeNull()
    expect((await served({ hsts: true })('/api/things')).headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect((await served({ hsts: { maxAgeSeconds: 600, includeSubDomains: true, preload: true } })('/')).headers.get('strict-transport-security'))
      .toBe('max-age=600; includeSubDomains; preload')
  })

  test('what throws outside a route carries them too', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const answer = await served({ routes: { '/broken': () => { throw new Error('disk full') } } })('/broken')
      expect(answer.status).toBe(500)
      expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    } finally {
      console.error = original
    }
  })
})
