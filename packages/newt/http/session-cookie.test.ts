import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { HttpRouter } from './http-router'
import { serve } from './serve'
import { clearSessionCookie, setSessionCookie } from './session-cookie'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

function served(secure: boolean) {
  const router = new HttpRouter()
  router.post('/in', request => {
    setSessionCookie(request, 'app_session', 'token-1', { secure, maxAgeSeconds: 3600 })
    return new Response(null, { status: 204 })
  }, { public: true })
  router.post('/pending', request => {
    setSessionCookie(request, 'app_pending', 'p-1', { secure, maxAgeSeconds: 600, path: '/api/session' })
    return new Response(null, { status: 204 })
  }, { public: true })
  router.post('/out', request => {
    clearSessionCookie(request, 'app_session', { secure })
    return new Response(null, { status: 204 })
  }, { public: true })
  const server = serve({ port: 0, router })
  servers.push(server)
  return async (path: string) => (await fetch(new URL(`/api${path}`, server.url), { method: 'POST' })).headers.get('set-cookie')!
}

describe('session cookies', () => {
  test('cannot be read by the page\'s scripts, nor sent by another site\'s requests', async () => {
    const cookie = await served(true)('/in')

    expect(cookie).toStartWith('app_session=token-1')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=3600')
  })

  test('are sent over plain HTTP only when not secure, as on localhost', async () => {
    expect(await served(false)('/in')).not.toContain('Secure')
  })

  test('go only to the path given', async () => {
    expect(await served(true)('/pending')).toContain('Path=/api/session')
  })

  test('cleared, are the same cookie, empty and already gone', async () => {
    const cookie = await served(true)('/out')

    expect(cookie).toStartWith('app_session=;')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })
})
