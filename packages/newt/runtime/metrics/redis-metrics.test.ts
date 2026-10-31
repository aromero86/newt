import { afterEach, describe, expect, test } from 'bun:test'
import { RedisClient } from 'bun'
import { RedisNonces } from '../../monitor/nonce-store'
import type { EventCount } from '../../core/metrics/event-count'
import type { InstanceSample } from '../../core/metrics/instance-sample'
import { MINUTE_MS, minuteOf } from './minutes'
import { RedisMetrics } from './redis-metrics'

// Against a real Redis, when there is one: REDIS_URL=redis://localhost:6390 bun test.
const url = process.env.REDIS_URL
const prefix = `newt:test:${crypto.randomUUID()}`
const opened: RedisMetrics[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(metrics => metrics.close()))
})

/** An instance of the application, counting into the shared Redis. */
function instance(keepMinutes?: number, own = '') {
  const metrics = new RedisMetrics({ url: url!, prefix: `${prefix}${own}`, flushMs: 50, keepMinutes })
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

  test('sums every instance\'s queue flows', async () => {
    const one = instance()
    const two = instance()
    const step = { context: 'shop', queue: 'invoice.open.on.order.placed', at }
    one.flow({ ...step, kind: 'published' })
    two.flow({ ...step, kind: 'redelivered', waitMs: 4 })
    one.flow({ ...step, kind: 'delivered', waitMs: 40 })
    await Bun.sleep(200)

    const { flows } = await two.closedFlows(null, new Date('2026-01-01T10:01:10Z'))
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({ published: 1, redelivered: 1, delivered: 1, dead: 0 })
    expect(Object.values(flows[0]!.wait).toSorted()).toEqual([1, 1])
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

/** A sample of an instance on server `s1`, at a time. */
function sample(instance: string, at: string, rssBytes = 100): InstanceSample {
  return {
    instance, pid: 7, startedAt: '2026-01-01T09:00:00.000Z', commit: null, at: new Date(at),
    process: { rssBytes, heapUsedBytes: 50, cpu: 10, loopMeanMs: 1, loopMaxMs: 2 },
    server: { disks: [{ path: '/', totalBytes: 1000, freeBytes: 400 }], memory: { totalBytes: 800, freeBytes: 400 }, cpu: { cores: 4, load: [1, 1, 1], usage: 20 } },
  }
}

describe.skipIf(!url)('RedisMetrics, when Redis fails', () => {
  test('adds a batch once, though part of it failed in Redis', async () => {
    const one = instance(undefined, ':once')
    const redis = new RedisClient(url!)
    // Where a later minute's hashes go, a string: Redis refuses to add to it, and adds the rest of the batch.
    const later = minuteOf(new Date('2026-01-01T10:05:20Z'))
    for (const name of [later, `uc:${later}`, `q:${later}`]) await redis.send('SET', [`${prefix}:once:${name}`, 'x', 'EX', '60'])
    for (const when of [at, new Date(later)]) {
      one.count({ ...told, at: when })
      one.time({ context: 'shop', useCase: 'order.place', scopes: {}, actor: 'ana', at: when, retries: 0, ms: 10 })
      one.flow({ context: 'shop', queue: 'invoice.open.on.order.placed', at: when, kind: 'published' })
    }
    // Several flushes: none adds again what the first one added.
    await Bun.sleep(300)
    redis.close()

    const now = new Date('2026-01-01T10:01:10Z')
    expect((await one.closed(null, now)).counts.map(count => count.count)).toEqual([1])
    expect((await one.closedTimings(null, now)).timings.map(timing => timing.calls)).toEqual([1])
    expect((await one.closedFlows(null, now)).flows.map(flow => flow.published)).toEqual([1])
  })

  test('keeps, of a batch Redis did not take, only the minutes it keeps', async () => {
    const one = instance(5, ':kept')
    const redis = new RedisClient(url!)
    // A key its connection watches, changed by another: Redis discards its next transaction whole.
    await (one as unknown as { redis: RedisClient }).redis.send('WATCH', [`${prefix}:kept:watched`])
    await redis.send('SET', [`${prefix}:kept:watched`, '1', 'EX', '60'])
    const now = Date.now()
    one.count({ ...told, at: new Date(now - 10 * MINUTE_MS) })
    one.count({ ...told, at: new Date(now) })
    await Bun.sleep(300)

    expect(await redis.hgetall(`${prefix}:kept:${minuteOf(now - 10 * MINUTE_MS)}`)).toEqual({})
    expect(Object.values(await redis.hgetall(`${prefix}:kept:${minuteOf(now)}`))).toEqual(['1'])
    redis.close()
  })
})

describe.skipIf(!url)('RedisMetrics, with instances', () => {
  test('gives every instance, and each one\'s minutes whole, to whichever is asked', async () => {
    const one = instance()
    const two = instance()
    one.sample(sample('a', '2026-01-01T10:00:05Z', 100))
    await Bun.sleep(100)
    // Written again, whole, with its next sample of the same minute.
    one.sample(sample('a', '2026-01-01T10:00:15Z', 300))
    two.sample(sample('b', '2026-01-01T10:00:25Z'))
    one.sample(sample('a', '2026-01-01T10:01:05Z'))
    await Bun.sleep(150)

    const read = await two.instances(null, new Date('2026-01-01T10:01:10Z'))
    expect(read.until).toBe('2026-01-01T10:00:00.000Z')
    expect(read.minutes.toSorted((x, y) => x.instance.localeCompare(y.instance)).map(minute => [minute.instance, minute.slots, minute.process.rssBytes.max]))
      .toEqual([['a', [0, 1], 300], ['b', [2], 100]])
    expect(read.instances.toSorted((x, y) => x.instance.localeCompare(y.instance)).map(each => [each.instance, each.status, each.lastSeenAt]))
      .toEqual([['a', 'alive', '2026-01-01T10:01:05.000Z'], ['b', 'lost', '2026-01-01T10:00:25.000Z']])
    expect((await one.instances(read.until, new Date('2026-01-01T10:01:10Z'))).minutes).toEqual([])
  })

  test('takes an instance for stopped once it said so, after its last sample', async () => {
    const one = instance(undefined, ':stopped')
    one.sample(sample('a', '2026-01-01T10:00:05Z'))
    await one.stopped('a', new Date('2026-01-01T10:00:06Z'))
    expect((await instance(undefined, ':stopped').instances(null, new Date('2026-01-01T10:05:00Z'))).instances).toMatchObject([{ instance: 'a', status: 'stopped', stoppedAt: '2026-01-01T10:00:06.000Z' }])
  })

  test('forgets an instance not seen for longer than it keeps minutes', async () => {
    const one = instance(5, ':forget')
    one.sample(sample('a', '2026-01-01T10:00:05Z'))
    await Bun.sleep(150)
    expect((await one.instances(null, new Date('2026-01-01T10:20:00Z'))).instances).toEqual([])
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
