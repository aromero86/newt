import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { Module, UseCase } from '../core'
import type { Store } from '../port-store'
import { Base, type ApplicationDescription } from '../runtime'
import { serveMonitor } from './serve-monitor'
import { signMonitorRequest } from './sign-monitor-request'
import type { MonitorIdentity } from './monitor-identity'

const KEY = 'a key both sides share, long enough'

class Thing_Module extends Module {
  constructor(base: Base) {
    super('thing', base.invocations)
  }

  @UseCase()
  async get() {}
}

let time = Date.parse('2026-01-01T00:00:00Z')
const clock = { now: () => new Date(time) }
let server: Server<undefined> | undefined

/** A monitor endpoint for one context, `shop`, with a module and its use case. */
function serve(): string {
  const shop = new Base({ name: 'shop', store: { outbox: {} } as unknown as Store })
  new Thing_Module(shop)
  server = serveMonitor([shop], { name: 'shop-app', port: 0, key: KEY, clock })
  return server.url.origin
}

const signed = (url: string, key = KEY, method = 'GET') => fetch(url, { method, headers: signMonitorRequest(key, { url, method, now: clock.now() }) })

afterEach(async () => {
  await server?.stop(true)
  server = undefined
})

describe('serveMonitor', () => {
  test('does not start without a key long enough', () => {
    expect(() => serveMonitor([], { name: 'shop-app', port: 0, key: '' })).toThrow('at least 32 characters')
    expect(() => serveMonitor([], { name: 'shop-app', port: 0, key: 'short' })).toThrow('at least 32 characters')
  })

  test('tells a signed request which application it is, and what it is made of', async () => {
    const origin = serve()

    const identity = await (await signed(`${origin}/v1/identity`)).json() as MonitorIdentity
    expect(identity).toMatchObject({ name: 'shop-app', startedAt: '2026-01-01T00:00:00.000Z', instance: { pid: process.pid } })
    const structure = await (await signed(`${origin}/v1/structure`)).json() as ApplicationDescription
    expect(structure.contexts[0]!.modules[0]!.useCases.map(useCase => useCase.id)).toEqual(['shop/thing.get'])
  })

  test('answers any other request a 401, whatever was wrong, and the key never travels', async () => {
    const origin = serve()
    const url = `${origin}/v1/structure`

    expect((await fetch(url)).status).toBe(401)
    expect((await signed(url, 'another key, just as long as the right one')).status).toBe(401)
    // Signed for one path, sent to another.
    expect((await fetch(`${origin}/v1/identity`, { headers: signMonitorRequest(KEY, { url, now: clock.now() }) })).status).toBe(401)
    // Not even which paths there are.
    expect((await fetch(`${origin}/nowhere`)).status).toBe(401)

    const headers = signMonitorRequest(KEY, { url, now: clock.now() })
    expect(Object.values(headers).some(value => value.includes(KEY))).toBe(false)
  })

  test('refuses the same request twice, and one made too long before or after now', async () => {
    const origin = serve()
    const url = `${origin}/v1/identity`
    const headers = signMonitorRequest(KEY, { url, now: clock.now() })

    expect((await fetch(url, { headers })).status).toBe(200)
    expect((await fetch(url, { headers })).status).toBe(401)
    expect((await fetch(url, { headers: signMonitorRequest(KEY, { url, now: new Date(time - 31_000) }) })).status).toBe(401)
    expect((await fetch(url, { headers: signMonitorRequest(KEY, { url, now: new Date(time + 31_000) }) })).status).toBe(401)
    expect((await fetch(url, { headers: signMonitorRequest(KEY, { url, now: new Date(time - 29_000) }) })).status).toBe(200)
  })

  test('reads only: a signed request of another method or path is refused once known to be the monitor\'s', async () => {
    const origin = serve()

    expect((await signed(`${origin}/v1/structure`, KEY, 'POST')).status).toBe(405)
    expect((await signed(`${origin}/v2/structure`)).status).toBe(404)
  })
})
