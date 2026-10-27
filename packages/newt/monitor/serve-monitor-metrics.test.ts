import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { SqliteStore } from '../adapter-sqlite'
import { ConcurrencyConflict, defineScope, Module, NotFoundError, runAsActor, UseCase, type Actor, type DomainEvent } from '../core'
import { Base, histogramPercentile, MemoryMetrics, type DeadJobs, type EventCounts, type OutboxState, type QueueFlows, type UseCaseTimings } from '../runtime'
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
async function serve(options: { metrics?: MemoryMetrics, jobs?: { backoffMs: number, pollMs: number } } = {}) {
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

describe('serveMonitor, with queue flows', () => {
  test('counts each queue\'s jobs as a broker would: published, redelivered, delivered, and how long they waited', async () => {
    const origin = await serve({ jobs: { backoffMs: 0, pollMs: 5 } })
    let failures = 1
    base!.bus.subscribe('order.placed', async () => {
      if (failures-- > 0) throw new Error('not yet')
    }, { mode: 'handler', name: 'invoice.open.on.order.placed', attempts: 3 })
    base!.jobs.start()
    await tell('order.placed')
    await base!.jobs.idle()
    await base!.jobs.stop()

    time += 60_000
    const { flows } = await (await signed(`${origin}/v1/metrics/queues`)).json() as QueueFlows
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({ context: 'shop', queue: 'invoice.open.on.order.placed', published: 1, redelivered: 1, delivered: 1, dead: 0 })
    // Taken twice, each time once it was ready: two waits.
    expect(Object.values(flows[0]!.wait).reduce((sum, count) => sum + count, 0)).toBe(2)
  })
})

describe('serveMonitor, with its outbox', () => {
  test('says how full each queue is now, and lists its dead jobs without their payloads', async () => {
    const origin = await serve({ jobs: { backoffMs: 0, pollMs: 5 } })
    base!.bus.subscribe('order.placed', async () => {
      throw new Error('the mailer is down')
    }, { mode: 'handler', name: 'invoice.open.on.order.placed', attempts: 1 })
    await tell('order.placed')
    await tell('order.placed')

    // Not started yet: both wait, ready.
    const waiting = await (await signed(`${origin}/v1/outbox`)).json() as OutboxState
    expect(waiting.contexts).toEqual([{ context: 'shop', queues: [expect.objectContaining({ queue: 'invoice.open.on.order.placed', ready: 2, dead: 0, orphan: false, oldestDueAt: expect.any(String) })] }])

    base!.jobs.start()
    await base!.jobs.idle()
    await base!.jobs.stop()
    const after = await (await signed(`${origin}/v1/outbox`)).json() as OutboxState
    expect(after.contexts[0]!.queues[0]).toMatchObject({ ready: 0, retrying: 0, running: 0, dead: 2, oldestDueAt: null })

    const page = await (await signed(`${origin}/v1/outbox/dead?context=shop&limit=1`)).json() as DeadJobs
    expect(page.hasMore).toBe(true)
    expect(page.jobs[0]).toMatchObject({ queue: 'invoice.open.on.order.placed', event: 'order.placed', attempts: 1 })
    expect(page.jobs[0]!.lastError).toContain('the mailer is down')
    expect(Object.keys(page.jobs[0]!)).not.toContain('payload')
    expect((await signed(`${origin}/v1/outbox/dead?context=nowhere`)).status).toBe(404)
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
