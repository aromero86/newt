import { describe, expect, test } from 'bun:test'
import type { InstanceSample } from '../../core/metrics/instance-sample'
import { instanceMinuteOf, instanceStateOf, slotOf } from './instance-minutes'
import { MemoryMetrics } from './memory-metrics'

/** A sample of instance `a` on server `s1`, at a time, with what a test says. */
function sample(at: string, change: { instance?: string, rss?: number, cpu?: number, loopMaxMs?: number, free?: number, usage?: number | null } = {}): InstanceSample {
  return {
    instance: change.instance ?? 'a',
    pid: 7,
    startedAt: '2026-01-01T09:00:00.000Z',
    commit: 'c1',
    at: new Date(at),
    process: { rssBytes: change.rss ?? 100, heapUsedBytes: 50, cpu: change.cpu ?? 10, loopMeanMs: 1, loopMaxMs: change.loopMaxMs ?? 2 },
    server: {
      disks: [{ path: '/', totalBytes: 1000, freeBytes: change.free ?? 400 }],
      memory: { totalBytes: 800, freeBytes: change.free ?? 400 },
      cpu: { cores: 4, load: [1, 1, 1], usage: change.usage === undefined ? 20 : change.usage },
    },
  }
}

describe('an instance minute', () => {
  test('is in 10-second slots', () => {
    expect(slotOf(new Date('2026-01-01T10:00:00Z'))).toBe(0)
    expect(slotOf(new Date('2026-01-01T10:00:09.999Z'))).toBe(0)
    expect(slotOf(new Date('2026-01-01T10:00:35Z'))).toBe(3)
    expect(slotOf(new Date('2026-01-01T10:00:59Z'))).toBe(5)
  })

  test('sums its samples up: means, the highest of a process, the lowest of what is left', () => {
    const minute = instanceMinuteOf('2026-01-01T10:00:00.000Z', [
      sample('2026-01-01T10:00:05Z', { rss: 100, cpu: 10, loopMaxMs: 3, free: 500, usage: 10 }),
      sample('2026-01-01T10:00:15Z', { rss: 300, cpu: 30, loopMaxMs: 40, free: 300, usage: null }),
    ])
    expect(minute.slots).toEqual([0, 1])
    expect(minute.process.rssBytes).toEqual({ mean: 200, max: 300 })
    expect(minute.process.cpu).toEqual({ mean: 20, max: 30 })
    expect(minute.process.loopMaxMs).toBe(40)
    expect(minute.server.disks).toEqual([{ path: '/', totalBytes: 1000, freeBytes: { mean: 400, min: 300 } }])
    expect(minute.server.memory.freeBytes).toEqual({ mean: 400, min: 300 })
    // A reading without the processors' usage counts in none of it.
    expect(minute.server.cpu.usage).toEqual({ mean: 10, max: 10 })
  })

  test('has no processors\' usage when none of its samples had it', () => {
    expect(instanceMinuteOf('2026-01-01T10:00:00.000Z', [sample('2026-01-01T10:00:05Z', { usage: null })]).server.cpu.usage).toBeNull()
  })
})

describe('an instance state', () => {
  const now = new Date('2026-01-01T10:01:00Z')

  test('is alive while it samples, lost after 30 seconds without, stopped once it said so', () => {
    expect(instanceStateOf({ sample: sample('2026-01-01T10:00:31Z'), stoppedAt: null }, now).status).toBe('alive')
    expect(instanceStateOf({ sample: sample('2026-01-01T10:00:29Z'), stoppedAt: null }, now).status).toBe('lost')
    expect(instanceStateOf({ sample: sample('2026-01-01T10:00:29Z'), stoppedAt: '2026-01-01T10:00:30.000Z' }, now)).toMatchObject({ status: 'stopped', stoppedAt: '2026-01-01T10:00:30.000Z' })
  })

  test('tells the commit it was built from, and none for a sample kept before samples told it', () => {
    const now = new Date('2026-01-01T10:01:00Z')
    expect(instanceStateOf({ sample: sample('2026-01-01T10:00:50Z'), stoppedAt: null }, now).commit).toBe('c1')
    const { commit: _, ...older } = sample('2026-01-01T10:00:50Z')
    expect(instanceStateOf({ sample: older as InstanceSample, stoppedAt: null }, now).commit).toBeNull()
  })
})

describe('MemoryMetrics, with instances', () => {
  test('gives every instance now and the minutes closed since a cursor', async () => {
    const metrics = new MemoryMetrics()
    metrics.enable()
    metrics.sample(sample('2026-01-01T10:00:05Z'))
    metrics.sample(sample('2026-01-01T10:00:15Z'))
    metrics.sample(sample('2026-01-01T10:00:25Z', { instance: 'b' }))
    metrics.sample(sample('2026-01-01T10:01:05Z'))

    const read = await metrics.instances(null, new Date('2026-01-01T10:01:10Z'))
    expect(read.until).toBe('2026-01-01T10:00:00.000Z')
    // The minute still open is not in.
    expect(read.minutes.map(minute => [minute.instance, minute.slots])).toEqual([['a', [0, 1]], ['b', [2]]])
    expect(read.instances.map(each => [each.instance, each.status, each.lastSeenAt])).toEqual([
      ['a', 'alive', '2026-01-01T10:01:05.000Z'],
      ['b', 'lost', '2026-01-01T10:00:25.000Z'],
    ])
    expect((await metrics.instances(read.until, new Date('2026-01-01T10:01:10Z'))).minutes).toEqual([])
  })

  test('keeps an instance\'s newest sample as its state, whatever order they came in', async () => {
    const metrics = new MemoryMetrics()
    metrics.enable()
    metrics.sample(sample('2026-01-01T10:00:35Z'))
    metrics.sample(sample('2026-01-01T10:00:05Z'))
    expect((await metrics.instances(null, new Date('2026-01-01T10:00:40Z'))).instances[0]!.lastSeenAt).toBe('2026-01-01T10:00:35.000Z')
  })

  test('takes an instance for stopped once it said so', async () => {
    const metrics = new MemoryMetrics()
    metrics.enable()
    metrics.sample(sample('2026-01-01T10:00:05Z'))
    await metrics.stopped('a', new Date('2026-01-01T10:00:06Z'))
    expect((await metrics.instances(null, new Date('2026-01-01T10:05:00Z'))).instances[0]).toMatchObject({ status: 'stopped', stoppedAt: '2026-01-01T10:00:06.000Z' })
  })

  test('keeps no sample until it is enabled', async () => {
    const metrics = new MemoryMetrics()
    metrics.sample(sample('2026-01-01T10:00:05Z'))
    expect(await metrics.instances(null, new Date('2026-01-01T10:05:10Z'))).toEqual({ instances: [], minutes: [], until: '2026-01-01T10:04:00.000Z' })
  })

  test('forgets the minutes and the instances older than it keeps', async () => {
    const metrics = new MemoryMetrics({ keepMinutes: 5 })
    metrics.enable()
    metrics.sample(sample('2026-01-01T10:00:05Z', { instance: 'old' }))
    metrics.sample(sample('2026-01-01T10:10:05Z'))
    const read = await metrics.instances(null, new Date('2026-01-01T10:11:10Z'))
    expect(read.minutes.map(minute => minute.instance)).toEqual(['a'])
    expect(read.instances.map(each => each.instance)).toEqual(['a'])
  })
})
