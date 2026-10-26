import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { browser } from './browser'
import { freePort } from './free-port'

const servers: Server<undefined>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
})

/** A site that signs in with a cookie, signs out, and sends the browser elsewhere. */
function site(port = 0) {
  const server = Bun.serve({
    port,
    routes: {
      '/sign-in': async request => {
        const { name } = await request.json() as { name: string }
        return new Response(null, { status: 204, headers: [['set-cookie', `session=${name}=1; Path=/; HttpOnly`], ['set-cookie', 'theme=dark; Max-Age=3600']] })
      },
      '/sign-out': () => new Response(null, { status: 204, headers: [['set-cookie', 'session=; Max-Age=0'], ['set-cookie', 'theme=dark; Expires=Thu, 01 Jan 1970 00:00:00 GMT']] }),
      '/me': request => Response.json({ cookie: request.headers.get('cookie'), extra: request.headers.get('x-extra') }),
      '/away': () => Response.redirect('/me', 302),
    },
  })
  servers.push(server)
  return server
}

describe('browser', () => {
  test('keeps the cookies it is given, sends them back, and forgets those deleted', async () => {
    const server = site()
    const as = browser(server.url.toString())

    expect(await (await as('/me')).json()).toEqual({ cookie: null, extra: null })
    await as('/sign-in', { method: 'POST', json: { name: 'ana' } })
    expect(await (await as('/me', { headers: { 'x-extra': 'yes' } })).json()).toEqual({ cookie: 'session=ana=1; theme=dark', extra: 'yes' })
    await as('/sign-out', { method: 'POST' })
    expect(await (await as('/me')).json()).toEqual({ cookie: null, extra: null })
  })

  test('never follows a redirect, and keeps each host\'s cookies apart', async () => {
    const [one, two] = [site(), site()]
    const as = browser()

    const away = await as(new URL('/away', one.url).toString())
    expect(away.status).toBe(302)
    expect(away.headers.get('location')).toBe('/me')
    await as(new URL('/sign-in', one.url).toString(), { method: 'POST', json: { name: 'ana' } })
    expect(await (await as(new URL('/me', two.url).toString())).json()).toMatchObject({ cookie: null })
  })
})

describe('freePort', () => {
  test('is a port a server can listen on at once', async () => {
    const port = freePort()
    expect(site(port).port).toBe(port)
  })
})
