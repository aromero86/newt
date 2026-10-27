import { afterEach, describe, expect, test } from 'bun:test'
import { RedisNonces } from '../../monitor/nonce-store'
import type { EventCount } from '../../core/metrics/event-count'
import { RedisMetrics } from './redis-metrics'

// Against a real Redis, when there is one: REDIS_URL=redis://localhost:6390 bun test.
const url = process.env.REDIS_URL
const prefix = `newt:test:${crypto.randomUUID()}`
const opened: RedisMetrics[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(metrics => metrics.close()))
})

/** An instance of the application, counting into the shared Redis. */
function instance() {
  const metrics = new RedisMetrics({ url: url!, prefix, flushMs: 50 })
  metrics.enable()
  opened.push(metrics)
  return metrics
}

const at = new Date('2026-01-01T10:00:20Z')
const told = { context: 'shop', event: 'order.placed', scopes: { workspace: 'acme' }, actor: 'ana', at }

describe.skipIf(!url)('RedisMetrics', () => {
  test('sums what every instance counted, once the minute is closed for all', async () => {
    const one = instance()
    const two = instance()
    one.count(told)
    two.count(told)
    two.count({ ...told, actor: 'bea' })
    await Bun.sleep(200)

    // Just after the minute ends, an instance may still be adding to it: not closed yet.
    expect((await one.closed(null, new Date('2026-01-01T10:01:00.010Z'))).counts).toEqual([])
    const closed = await two.closed(null, new Date('2026-01-01T10:01:10Z'))
    expect(closed.until).toBe('2026-01-01T10:00:00.000Z')
    expect(closed.counts.toSorted((a, b) => b.count - a.count).map(count => [count.actor, count.count])).toEqual([['ana', 2], ['bea', 1]])
    expect((await one.closed(closed.until, new Date('2026-01-01T10:01:10Z'))).counts).toEqual([])
  })

  test('sums every instance\'s timings, bucket by bucket', async () => {
    const one = instance()
    const two = instance()
    const call = { context: 'shop', useCase: 'order.place', scopes: {}, actor: 'ana', at, retries: 0 }
    one.time({ ...call, ms: 10 })
    two.time({ ...call, ms: 10, retries: 1 })
    two.time({ ...call, ms: 200, outcome: { kind: 'error', code: 'order.not_found' } })
    one.time({ ...call, ms: 5, outcome: { kind: 'failure', code: 'Type#Error' } })
    await Bun.sleep(200)

    const { timings } = await one.closedTimings(null, new Date('2026-01-01T10:01:10Z'))
    expect(timings).toHaveLength(1)
    expect(timings[0]).toMatchObject({ useCase: 'order.place', calls: 4, retries: 1, totalMs: 225, errors: { 'order.not_found': 1 }, failures: { 'Type#Error': 1 } })
    expect(Object.values(timings[0]!.histogram).toSorted()).toEqual([1, 1, 2])
  })

  test('tells every instance\'s counts live to whichever instance listens', async () => {
    const listening = instance()
    const counting = instance()
    const heard: EventCount[] = []
    const stop = await listening.live(counts => heard.push(...counts))

    counting.count(told)
    await Bun.sleep(300)
    stop()
    expect(heard.map(count => [count.event, count.count])).toEqual([['order.placed', 1]])
  })
})

describe.skipIf(!url)('RedisNonces', () => {
  test('a nonce one instance saw is refused by every other', async () => {
    const one = new RedisNonces({ url: url!, prefix })
    const two = new RedisNonces({ url: url!, prefix })
    const now = Date.now()

    expect(await one.remember('n1', now + 30_000, now)).toBe(true)
    expect(await two.remember('n1', now + 30_000, now)).toBe(false)
    one.close()
    two.close()
  })
})
