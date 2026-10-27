import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { SqliteStore } from '../adapter-sqlite'
import { defineScope, runAsActor, type Actor, type DomainEvent } from '../core'
import { Base, MemoryEventMetrics, type EventCounts } from '../runtime'
import { MemoryNonces } from './nonce-store'
import { serveMonitor } from './serve-monitor'
import { signMonitorRequest } from './sign-monitor-request'

const KEY = 'a key both sides share, long enough'
const workspace = defineScope<{ workspaceId: string }>('workspace')

let time = Date.parse('2026-01-01T10:00:20Z')
const clock = { now: () => new Date(time) }
let server: Server<undefined> | undefined
let base: Base | undefined

afterEach(async () => {
  await server?.stop(true)
  await base?.close()
  server = undefined
  base = undefined
})

const event = (name: string): DomainEvent => ({ name, occurredAt: clock.now().toISOString(), payload: {} }) as unknown as DomainEvent
const ana = { userId: 'ana' } as Actor

/** A context `shop` whose events are counted, served on a free port. */
async function serve(options: { metrics?: MemoryEventMetrics } = {}) {
  base = new Base({ name: 'shop', store: await SqliteStore.open({ path: ':memory:' }), clock, ...options })
  server = serveMonitor([base], { name: 'shop-app', port: 0, key: KEY, clock })
  return server.url.origin
}

const signed = (url: string) => fetch(url, { headers: signMonitorRequest(KEY, { url, now: clock.now() }) })
const tell = (name: string) => base!.store.transaction(() => base!.publisher.publish(event(name)))

describe('serveMonitor, with metrics', () => {
  test('counts each event told by minute, actor and scope, and gives the minutes closed', async () => {
    const origin = await serve()
    await runAsActor(ana, () => workspace.run({ workspaceId: 'acme' }, async () => {
      await tell('order.placed')
      await tell('order.placed')
    }))
    await tell('order.placed')

    // The minute is still open: nothing yet.
    expect(await (await signed(`${origin}/v1/metrics`)).json()).toEqual({ counts: [], until: '2026-01-01T09:59:00.000Z' })

    time += 60_000
    const closed = await (await signed(`${origin}/v1/metrics`)).json() as EventCounts
    expect(closed.until).toBe('2026-01-01T10:00:00.000Z')
    expect(closed.counts.toSorted((a, b) => b.count - a.count)).toEqual([
      { minute: '2026-01-01T10:00:00.000Z', context: 'shop', event: 'order.placed', scopes: { workspace: 'acme' }, actor: 'ana', count: 2 },
      { minute: '2026-01-01T10:00:00.000Z', context: 'shop', event: 'order.placed', scopes: {}, actor: null, count: 1 },
    ])
    // From the cursor on, nothing again.
    expect((await (await signed(`${origin}/v1/metrics?since=${closed.until}`)).json() as EventCounts).counts).toEqual([])
  })

  test('counts nothing told in a transaction that did not commit', async () => {
    const origin = await serve()
    await base!.store.transaction(async () => {
      await base!.publisher.publish(event('order.placed'))
      throw new Error('rolled back')
    }).catch(() => undefined)

    time += 60_000
    expect((await (await signed(`${origin}/v1/metrics`)).json() as EventCounts).counts).toEqual([])
  })

  test('tells counts live, as server-sent events', async () => {
    const origin = await serve({ metrics: new MemoryEventMetrics({ liveMs: 10 }) })
    const response = await signed(`${origin}/v1/metrics/live`)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const read = async () => new TextDecoder().decode((await reader.read()).value)

    expect(await read()).toContain(': live')
    await tell('order.placed')
    expect(await read()).toContain('"event":"order.placed","scopes":{},"actor":null,"count":1')
    await reader.cancel()
  })

  test('keeps nothing until it is served: an application nobody monitors counts nothing', async () => {
    const metrics = new MemoryEventMetrics()
    base = new Base({ name: 'shop', store: await SqliteStore.open({ path: ':memory:' }), clock, metrics })
    await tell('order.placed')
    time += 60_000

    expect((await metrics.closed(null, clock.now())).counts).toEqual([])
  })
})

describe('MemoryNonces', () => {
  test('keeps a nonce until its time, and refuses it meanwhile', async () => {
    const nonces = new MemoryNonces()
    expect(await nonces.remember('n1', 2_000, 1_000)).toBe(true)
    expect(await nonces.remember('n1', 2_000, 1_500)).toBe(false)
    expect(await nonces.remember('n1', 4_000, 3_000)).toBe(true)
  })
})
