import { describe, expect, test } from 'bun:test'
import { currentActor, defineScope, NoActor, runAsActor, type Actor } from '../../core'
import { InMemoryEventBus } from './in-memory-event-bus'

const event = { name: 'test.happened', payload: {}, occurredAt: '' }
const named = (name: string) => ({ name, payload: name, occurredAt: '' })

const settle = () => Bun.sleep(0)

/** What `console.error` gets while `fn` runs. */
async function errorsOf(fn: () => Promise<unknown>): Promise<unknown[]> {
  const logged: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  try {
    await fn()
  } finally {
    console.error = original
  }
  return logged
}

describe('a handler', () => {
  test('does not inherit the actor of whatever published: it reacts as the system', async () => {
    const bus = new InMemoryEventBus()
    const seen: unknown[] = []
    bus.subscribe('test.happened', () => {
      try {
        seen.push(currentActor())
      } catch (error) {
        seen.push(error instanceof NoActor ? 'nobody' : error)
      }
    })

    await runAsActor({ userId: 'ana' } satisfies Actor, async () => {
      bus.publish(event)
      await settle()
    })

    expect(seen).toEqual(['nobody'])
  })

  test('inherits no actor nor scope of whatever made the bus, as a context opened inside a request', async () => {
    const workspace = defineScope<string>('workspace')
    const bus = await runAsActor({ userId: 'ana' }, () => workspace.run('w1', async () => new InMemoryEventBus()))
    const seen: unknown[] = []
    bus.subscribe('test.happened', () => {
      try {
        seen.push(currentActor())
      } catch (error) {
        seen.push(error instanceof NoActor ? 'nobody' : error)
      }
      seen.push(workspace.find() ?? 'no workspace')
    })

    bus.publish(event)
    await settle()

    expect(seen).toEqual(['nobody', 'no workspace'])
  })

  test('runs after publish returns, not during it', () => {
    const bus = new InMemoryEventBus()
    const seen: unknown[] = []
    bus.subscribe('test.happened', () => { seen.push('ran') })

    bus.publish(event)

    expect(seen).toEqual([])
  })

  test('that throws does not bring the publisher down, it only logs', async () => {
    const bus = new InMemoryEventBus()
    bus.subscribe('test.happened', () => { throw new Error('boom') })

    const logged = await errorsOf(async () => {
      expect(() => bus.publish(event)).not.toThrow()
      await settle()
    })

    expect(logged).toHaveLength(1)
  })

  test('that rejects later is logged too', async () => {
    const bus = new InMemoryEventBus()
    bus.subscribe('test.happened', async () => {
      await settle()
      throw new Error('boom')
    })

    const logged = await errorsOf(async () => {
      bus.publish(event)
      await Bun.sleep(5)
    })

    expect(logged).toHaveLength(1)
  })
})

describe('subscriptions', () => {
  test('every one the event concerns runs, by name or by prefix, and no other', async () => {
    const bus = new InMemoryEventBus()
    const seen: string[] = []
    bus.subscribe('user.created', () => { seen.push('exact') })
    bus.subscribe('user.*', () => { seen.push('prefix') })
    bus.subscribe('order.*', () => { seen.push('other') })

    bus.publish(named('user.created'))
    await settle()

    expect(seen.sort()).toEqual(['exact', 'prefix'])
  })

  test('one that throws keeps none of the others from running', async () => {
    const bus = new InMemoryEventBus()
    const seen: string[] = []
    bus.subscribe('user.created', () => { throw new Error('boom') })
    bus.subscribe('user.created', () => { seen.push('second') })

    await errorsOf(async () => {
      bus.publish(named('user.created'))
      await settle()
    })

    expect(seen).toEqual(['second'])
  })

  test('unsubscribing ends that one only', async () => {
    const bus = new InMemoryEventBus()
    const seen: string[] = []
    const unsubscribe = bus.subscribe('user.created', () => { seen.push('gone') })
    bus.subscribe('user.created', () => { seen.push('stays') })

    unsubscribe()
    bus.publish(named('user.created'))
    await settle()

    expect(seen).toEqual(['stays'])
  })
})
