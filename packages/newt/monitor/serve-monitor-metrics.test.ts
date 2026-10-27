import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { SqliteStore } from '../adapter-sqlite'
import { ConcurrencyConflict, defineScope, Module, NotFoundError, runAsActor, UseCase, type Actor, type DomainEvent } from '../core'
import { Base, histogramPercentile, MemoryMetrics, type EventCounts, type UseCaseTimings } from '../runtime'
import { MemoryNonces } from './nonce-store'
import { serveMonitor } from './serve-monitor'
import { signMonitorRequest } from './sign-monitor-request'

const KEY = 'a key both sides share, long enough'

class CardNotFound extends NotFoundError {
  readonly code = 'card.not_found'
}
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
async function serve(options: { metrics?: MemoryMetrics } = {}) {
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
    expect(await (await signed(`${origin}/v1/metrics/events`)).json()).toEqual({ counts: [], until: '2026-01-01T09:59:00.000Z' })

    time += 60_000
    const closed = await (await signed(`${origin}/v1/metrics/events`)).json() as EventCounts
    expect(closed.until).toBe('2026-01-01T10:00:00.000Z')
    expect(closed.counts.toSorted((a, b) => b.count - a.count)).toEqual([
      { minute: '2026-01-01T10:00:00.000Z', context: 'shop', event: 'order.placed', scopes: { workspace: 'acme' }, actor: 'ana', count: 2 },
      { minute: '2026-01-01T10:00:00.000Z', context: 'shop', event: 'order.placed', scopes: {}, actor: null, count: 1 },
    ])
    // From the cursor on, nothing again.
    expect((await (await signed(`${origin}/v1/metrics/events?since=${closed.until}`)).json() as EventCounts).counts).toEqual([])
  })

  test('counts nothing told in a transaction that did not commit', async () => {
    const origin = await serve()
    await base!.store.transaction(async () => {
      await base!.publisher.publish(event('order.placed'))
      throw new Error('rolled back')
    }).catch(() => undefined)

    time += 60_000
    expect((await (await signed(`${origin}/v1/metrics/events`)).json() as EventCounts).counts).toEqual([])
  })

  test('tells counts live, as server-sent events', async () => {
    const origin = await serve({ metrics: new MemoryMetrics({ liveMs: 10 }) })
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
    const metrics = new MemoryMetrics()
    base = new Base({ name: 'shop', store: await SqliteStore.open({ path: ':memory:' }), clock, metrics })
    await tell('order.placed')
    time += 60_000

    expect((await metrics.closed(null, clock.now())).counts).toEqual([])
  })
})

describe('serveMonitor, with use case timings', () => {
  test('times each call by minute, actor and scope, with its runs more after a conflict', async () => {
    const origin = await serve()
    let conflicts = 1
    class Order_Module extends Module {
      constructor() {
        super('order', base!.invocations)
      }

      @UseCase()
      async place(ms: number) {
        await Bun.sleep(ms)
        if (conflicts-- > 0) throw new ConcurrencyConflict()
      }
    }
    const orders = new Order_Module()
    await runAsActor(ana, () => workspace.run({ workspaceId: 'acme' }, async () => {
      await orders.place(20)
      await orders.place(5)
    }))
    // The framework's own invocations are no one's use case: not timed.
    await base!.invocations.run('job.claim', async () => [])

    time += 60_000
    const closed = await (await signed(`${origin}/v1/metrics/use-cases`)).json() as UseCaseTimings
    expect(closed.timings).toHaveLength(1)
    const [timing] = closed.timings
    expect(timing).toMatchObject({ context: 'shop', useCase: 'order.place', scopes: { workspace: 'acme' }, actor: 'ana', calls: 2, retries: 1 })
    // The first call ran twice (its retry included), the second once.
    expect(timing!.totalMs).toBeGreaterThan(44)
    expect(histogramPercentile(timing!.histogram, 99)!).toBeGreaterThan(38)
    expect([timing!.errors, timing!.failures]).toEqual([{}, {}])
  })

  test('says how each call that threw ended: an error by its code, a failure by its class', async () => {
    const origin = await serve()
    class Card_Module extends Module {
      constructor() {
        super('card', base!.invocations)
      }

      @UseCase()
      async get(what: 'missing' | 'broken' | 'fine') {
        if (what === 'missing') throw new CardNotFound('There is no card c1')
        if (what === 'broken') throw new TypeError('x is undefined')
      }
    }
    const cards = new Card_Module()
    for (const what of ['missing', 'missing', 'broken', 'fine'] as const) await cards.get(what).catch(() => undefined)

    time += 60_000
    const [timing] = ((await (await signed(`${origin}/v1/metrics/use-cases`)).json()) as UseCaseTimings).timings
    expect(timing).toMatchObject({ useCase: 'card.get', calls: 4, errors: { 'card.not_found': 2 }, failures: { TypeError: 1 } })
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
