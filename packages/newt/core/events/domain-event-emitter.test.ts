import { describe, expect, test } from 'bun:test'
import type { DomainEvent } from './domain-event'
import type { EventBus } from './event-bus'
import type { EventHandler } from './event-handler'
import type { SubscribeOptions } from './subscribe-options'
import { eventsOf } from './events-of'

class Confirmed implements DomainEvent<{ id: string }> {
  static readonly eventName = 'order.confirmed'
  readonly name = Confirmed.eventName
  readonly occurredAt = ''
  constructor(readonly payload: { id: string }) {}
}

class Placed implements DomainEvent<{ id: string }> {
  static readonly eventName = 'order.placed'
  readonly name = Placed.eventName
  readonly occurredAt = ''
  constructor(readonly payload: { id: string }) {}
}

/** A bus that keeps what was subscribed, to look at it. */
function recordingBus() {
  const subscriptions: { pattern: string, handler: EventHandler, options?: SubscribeOptions }[] = []
  const unsubscribes: (() => void)[] = []
  const bus: EventBus = {
    publish: () => {},
    subscribe: (pattern, handler, options) => {
      subscriptions.push({ pattern, handler, options })
      const unsubscribe = () => {}
      unsubscribes.push(unsubscribe)
      return unsubscribe
    },
  }
  return { bus, subscriptions, unsubscribes }
}

describe('DomainEventEmitter.subscribe', () => {
  test('a handler subscribes durably, on the queue it names', async () => {
    const { bus, subscriptions } = recordingBus()
    const seen: unknown[] = []
    const { placed } = eventsOf(bus, { placed: Placed })

    placed.subscribe(order => seen.push(order), { strategy: 'handler', queue: 'notification.orderPlaced.on.order.placed' })
    placed.subscribe(order => seen.push(order.id), { strategy: 'handler', queue: 'notification.remind.on.order.placed', attempts: 2 })
    for (const { handler } of subscriptions) await handler(new Placed({ id: 'o1' }))

    expect(subscriptions.map(each => [each.pattern, each.options])).toEqual([
      ['order.placed', { mode: 'handler', name: 'notification.orderPlaced.on.order.placed', attempts: undefined }],
      ['order.placed', { mode: 'handler', name: 'notification.remind.on.order.placed', attempts: 2 }],
    ])
    expect(seen).toEqual([{ id: 'o1' }, 'o1'])
  })

  test('a fire-and-forget subscription stays in memory', async () => {
    const { bus, subscriptions } = recordingBus()
    const seen: unknown[] = []

    eventsOf(bus, { placed: Placed }).placed.subscribe(order => seen.push(order), { strategy: 'fire-and-forget' })
    await subscriptions[0]!.handler(new Placed({ id: 'o1' }))

    expect(subscriptions[0]?.options).toBeUndefined()
    expect(seen).toEqual([{ id: 'o1' }])
  })

  test("refuses a queue that does not say who reacts with what to this event", () => {
    const { placed } = eventsOf(recordingBus().bus, { placed: Placed })

    expect(() => placed.subscribe(() => {}, { strategy: 'handler', queue: 'notification.orderPlaced.on.order.confirmed' })).toThrow('<module>.<use case>.on.order.placed')
    expect(() => placed.subscribe(() => {}, { strategy: 'handler', queue: 'notification.order.placed.on.order.placed' })).toThrow()
  })
})

describe('DomainEventEmitter.subscribe, further', () => {
  test('hands back what unsubscribes it, whatever the strategy', () => {
    const { bus, unsubscribes } = recordingBus()
    const { placed } = eventsOf(bus, { placed: Placed })

    const inMemory = placed.subscribe(() => {}, { strategy: 'fire-and-forget' })
    const durable = placed.subscribe(() => {}, { strategy: 'handler', queue: 'notification.orderPlaced.on.order.placed' })

    expect(inMemory).toBe(unsubscribes[0]!)
    expect(durable).toBe(unsubscribes[1]!)
  })

  test('waits for an async handler, and lets its failure through, whatever the strategy', async () => {
    const { bus, subscriptions } = recordingBus()
    const { placed } = eventsOf(bus, { placed: Placed })
    const done: string[] = []
    const slow = async () => {
      await Bun.sleep(1)
      done.push('handled')
    }

    placed.subscribe(slow, { strategy: 'fire-and-forget' })
    placed.subscribe(slow, { strategy: 'handler', queue: 'notification.orderPlaced.on.order.placed' })
    placed.subscribe(async () => { throw new Error('boom') }, { strategy: 'fire-and-forget' })
    placed.subscribe(async () => { throw new Error('boom') }, { strategy: 'handler', queue: 'notification.fail.on.order.placed' })

    await subscriptions[0]!.handler(new Placed({ id: 'o1' }))
    await subscriptions[1]!.handler(new Placed({ id: 'o1' }))
    expect(done).toEqual(['handled', 'handled'])
    await expect(subscriptions[2]!.handler(new Placed({ id: 'o1' }))).rejects.toThrow('boom')
    await expect(subscriptions[3]!.handler(new Placed({ id: 'o1' }))).rejects.toThrow('boom')
  })
})

describe('a payload', () => {
  test('is JSON, as a handler gets it back from its stored job: a Date is not', () => {
    // @ts-expect-error a Date would reach a `handler` as a string
    class Due implements DomainEvent<{ dueAt: Date }> {
      static readonly eventName = 'invoice.due'
      readonly name = Due.eventName
      readonly occurredAt = ''
      constructor(readonly payload: { dueAt: Date }) {}
    }
    class DueOn implements DomainEvent<{ dueAt: string, paidAt?: string }> {
      static readonly eventName = 'invoice.due'
      readonly name = DueOn.eventName
      readonly occurredAt = ''
      constructor(readonly payload: { dueAt: string, paidAt?: string }) {}
    }

    expect(eventsOf(recordingBus().bus, { due: DueOn }).due.name).toBe(Due.eventName)
  })
})

describe('eventsOf', () => {
  test('gives each event its own emitter, named after it', () => {
    const { bus, subscriptions } = recordingBus()
    const events = eventsOf(bus, { placed: Placed, confirmed: Confirmed })

    events.placed.subscribe(() => {}, { strategy: 'fire-and-forget' })
    events.confirmed.subscribe(() => {}, { strategy: 'fire-and-forget' })

    expect([events.placed.name, events.confirmed.name]).toEqual(['order.placed', 'order.confirmed'])
    expect(subscriptions.map(each => each.pattern)).toEqual(['order.placed', 'order.confirmed'])
  })
})
