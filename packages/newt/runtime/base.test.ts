import { describe, expect, test } from 'bun:test'
import type { DomainEvent, Span, SpanAttributes, Tracer } from '../core'
import type { Job, Outbox } from '../port-outbox'
import { TransactionScope, type Store } from '../port-store'
import { Base } from './base'
import { BoundedContext } from './bounded-context'
import { MemoryMetrics } from './metrics/memory-metrics'

/** A store whose transactions, outbox writes and closing all go to one log. */
function fakeStore(log: string[]): Store {
  const scope = new TransactionScope()
  const outbox = {
    add: async (jobs: Job[]) => void log.push(`outbox ${jobs.map(job => job.queue).join(',')}`),
    claim: async () => [],
    seen: async () => {},
    purge: async () => {},
    list: async () => [],
    queues: async () => [],
  } as unknown as Outbox
  return {
    transaction: fn => scope.run(fn, undefined, {
      begin: () => void log.push('begin'),
      commit: () => void log.push('commit'),
      rollback: () => void log.push('rollback'),
    }),
    guard: async () => {},
    afterCommit: fn => scope.afterCommit(fn),
    afterRollback: fn => scope.afterRollback(fn),
    table: () => { throw new Error('no tables here') },
    outbox,
    migrations: {} as never,
    close: async () => void log.push('store closed'),
  }
}

const created: DomainEvent = { name: 'user.created', payload: { id: 'u1' }, occurredAt: '' }
const settle = () => Bun.sleep(0)

describe('the publisher', () => {
  test('writes the jobs in the transaction, and runs the rest once it commits', async () => {
    const log: string[] = []
    const base = new Base({ name: 'shop', store: fakeStore(log) })
    base.bus.subscribe('user.created', () => void log.push('in memory'))
    base.bus.subscribe('user.created', () => {}, { mode: 'handler', name: 'mail.sendWelcome.on.user.created' })
    base.jobs.wake = () => void log.push('jobs woken')

    await base.store.transaction(async () => {
      await base.publisher.publish(created)
      log.push('save goes on')
    })
    await settle()

    expect(log).toEqual(['begin', 'outbox mail.sendWelcome.on.user.created', 'save goes on', 'commit', 'jobs woken', 'in memory'])
  })

  test('gives the event one id, the same for its jobs and its handlers in memory, and keeps one it came with', async () => {
    const store = fakeStore([])
    const stored: Job[] = []
    store.outbox.add = async jobs => void stored.push(...jobs)
    const base = new Base({ name: 'shop', store })
    const heard: string[] = []
    base.bus.subscribe('user.created', event => void heard.push(event.id))
    base.bus.subscribe('user.created', () => {}, { mode: 'handler', name: 'mail.sendWelcome.on.user.created' })
    base.bus.subscribe('user.created', () => {}, { mode: 'handler', name: 'audit.record.on.user.created' })

    await store.transaction(() => base.publisher.publish(created))
    await store.transaction(() => base.publisher.publish({ ...created, id: 'given' }))
    await settle()

    const ids = stored.map(job => (JSON.parse(job.event) as DomainEvent).id)
    expect(heard).toEqual([ids[0]!, 'given'])
    expect(ids).toEqual([heard[0]!, heard[0]!, 'given', 'given'])
    expect(heard[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('on a rollback, nothing runs', async () => {
    const log: string[] = []
    const base = new Base({ name: 'shop', store: fakeStore(log) })
    base.bus.subscribe('user.created', () => void log.push('in memory'))
    base.jobs.wake = () => void log.push('jobs woken')

    await base.store.transaction(async () => {
      await base.publisher.publish(created)
      throw new Error('boom')
    }).catch(() => {})
    await settle()

    expect(log).toEqual(['begin', 'rollback'])
  })

  test('the bus publishes as a repository does', async () => {
    const log: string[] = []
    const base = new Base({ name: 'shop', store: fakeStore(log) })
    base.bus.subscribe('user.created', () => {}, { mode: 'handler', name: 'mail.sendWelcome.on.user.created' })

    await base.store.transaction(() => base.bus.publish(created))

    expect(log).toEqual(['begin', 'outbox mail.sendWelcome.on.user.created', 'commit'])
  })

  test('counts the event, and its jobs as published, in the minute its transaction commits', async () => {
    let time = Date.parse('2026-01-01T10:00:59.900Z')
    const metrics = new MemoryMetrics()
    metrics.enable()
    const base = new Base({ name: 'shop', store: fakeStore([]), metrics, clock: { now: () => new Date(time) } })
    base.bus.subscribe('user.created', () => {}, { mode: 'handler', name: 'mail.sendWelcome.on.user.created' })
    base.jobs.wake = () => {}

    await base.store.transaction(async () => {
      await base.publisher.publish(created)
      time = Date.parse('2026-01-01T10:01:00.300Z')
    })

    const now = new Date('2026-01-01T10:05:00Z')
    expect((await metrics.closed(null, now)).counts.map(count => [count.minute, count.count])).toEqual([['2026-01-01T10:01:00.000Z', 1]])
    expect((await metrics.closedFlows(null, now)).flows.map(flow => [flow.minute, flow.queue])).toEqual([['2026-01-01T10:01:00.000Z', 'mail.sendWelcome.on.user.created']])
  })
})

describe('the invocations', () => {
  test('carry the context name to every span, and the write rule it was given', async () => {
    const attributes: SpanAttributes[] = []
    const tracer: Tracer = {
      startActiveSpan<T>(_name: string, given: SpanAttributes, fn: (span: Span) => Promise<T>) {
        attributes.push(given)
        return fn({ setError() {}, addEvent() {}, end() {} })
      },
    }
    const base = new Base({ name: 'shop', store: fakeStore([]), tracer, writeRule: 'error' })

    const write = base.invocations.run('order.place', () => base.invocations.run('stock.reserve', async () => base.invocations.checkWrite()))

    await expect(write).rejects.toThrow('order.place writes to shop.stock')
    expect(attributes[0]).toMatchObject({ context: 'shop', module: 'order', useCase: 'order.place' })
  })
})

describe('a bounded context', () => {
  class Shop extends BoundedContext {
    constructor(base: Base) {
      super('shop', base)
    }
  }

  test('starts its jobs, and stops them before closing its store', async () => {
    const log: string[] = []
    const base = new Base({ name: 'shop', store: fakeStore(log) })
    base.jobs.start = () => void log.push('jobs started')
    base.jobs.stop = async () => {
      await Bun.sleep(5)
      log.push('jobs stopped')
    }
    const shop = new Shop(base)

    shop.start()
    await shop.stop()

    expect(log).toEqual(['jobs started', 'jobs stopped', 'store closed'])
  })
})
