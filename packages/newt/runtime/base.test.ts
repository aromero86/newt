import { describe, expect, test } from 'bun:test'
import type { DomainEvent, Span, SpanAttributes, Tracer } from '../core'
import type { Job, Outbox } from '../port-outbox'
import { TransactionScope, type Store } from '../port-store'
import { Base } from './base'
import { BoundedContext } from './bounded-context'

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
