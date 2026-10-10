import { describe, expect, test } from 'bun:test'
import { currentUnitOfWork } from '../../core/unit-of-work/current-unit-of-work'
import { runInUnitOfWork } from '../../core/unit-of-work/run-in-unit-of-work'
import { InMemoryEventBus } from './in-memory-event-bus'

const event = { name: 'test.happened', payload: {}, occurredAt: '' }

const settle = () => Bun.sleep(0)

describe('a handler', () => {
  test('does not inherit the unit of work: the commit already happened', async () => {
    const bus = new InMemoryEventBus()
    const seen: unknown[] = []
    bus.subscribe('test.happened', () => { seen.push(currentUnitOfWork()) })

    await runInUnitOfWork({ events: [], opened: false }, async () => { /* commits here */ })
    bus.publish(event)
    await settle()

    expect(seen).toEqual([undefined])
  })

  test('that throws does not bring the publisher down, it only logs', async () => {
    const bus = new InMemoryEventBus()
    bus.subscribe('test.happened', () => { throw new Error('boom') })

    const logged: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { logged.push(args) }

    try {
      expect(() => bus.publish(event)).not.toThrow()
      await settle()
    } finally {
      console.error = original
    }

    expect(logged).toHaveLength(1)
  })
})
