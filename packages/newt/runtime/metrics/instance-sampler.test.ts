import { afterEach, describe, expect, test } from 'bun:test'
import { InstanceSampler } from './instance-sampler'
import { MemoryMetrics } from './memory-metrics'

let time = Date.parse('2026-01-01T10:00:05Z')
const clock = { now: () => new Date(time) }
let sampler: InstanceSampler | undefined

afterEach(async () => {
  await sampler?.stop()
  sampler = undefined
})

function sampled(options: { disks?: string[] } = {}) {
  const metrics = new MemoryMetrics()
  metrics.enable()
  sampler = new InstanceSampler(metrics, { instance: 'i-1', startedAt: '2026-01-01T10:00:00.000Z', clock, everyMs: 60_000, ...options })
  return metrics
}

describe('InstanceSampler', () => {
  test('reads its process and its server, as they are', async () => {
    const metrics = sampled({ disks: ['/', import.meta.dir] })
    await sampler!.take()
    const [state] = (await metrics.instances(null, clock.now())).instances
    expect(state).toMatchObject({ instance: 'i-1', pid: process.pid, startedAt: '2026-01-01T10:00:00.000Z', status: 'alive', lastSeenAt: '2026-01-01T10:00:05.000Z' })
    expect(state!.process.rssBytes).toBeGreaterThan(0)
    expect(state!.process.heapUsedBytes).toBeGreaterThan(0)
    expect(state!.process.cpu).toBeGreaterThanOrEqual(0)
    expect(state!.process.loopMaxMs).toBeGreaterThanOrEqual(0)
    expect(state!.server.disks.map(disk => disk.path)).toEqual(['/', import.meta.dir])
    for (const disk of state!.server.disks) expect(disk.freeBytes).toBeLessThanOrEqual(disk.totalBytes)
    expect(state!.server.memory.freeBytes).toBeLessThanOrEqual(state!.server.memory.totalBytes)
    expect(state!.server.cpu.cores).toBeGreaterThan(0)
    // The processors' usage is of the time between two readings: none on the first.
    expect(state!.server.cpu.usage).toBeNull()
  })

  test('reads the processors\' usage from the second reading on, where /proc/stat is', async () => {
    const metrics = sampled()
    await sampler!.take()
    await Bun.sleep(50)
    await sampler!.take()
    const usage = (await metrics.instances(null, clock.now())).instances[0]!.server.cpu.usage
    if (process.platform === 'linux') {
      expect(usage).toBeGreaterThanOrEqual(0)
      expect(usage).toBeLessThanOrEqual(100)
    } else {
      expect(usage).toBeNull()
    }
  })

  test('sees an event loop that was blocked', async () => {
    const metrics = sampled()
    sampler!.start()
    await Bun.sleep(30)
    const blockedUntil = performance.now() + 150
    while (performance.now() < blockedUntil) { /* the event loop waits */ }
    await Bun.sleep(30)
    await sampler!.take()
    const { process } = (await metrics.instances(null, clock.now())).instances[0]!
    expect(process.loopMaxMs).toBeGreaterThan(100)
  })

  test('skips a reading that fails, and says it', async () => {
    const metrics = sampled({ disks: ['/no/such/path'] })
    const errors: unknown[] = []
    const error = console.error
    console.error = (...args: unknown[]) => errors.push(args[0])
    try {
      await sampler!.take()
    } finally {
      console.error = error
    }
    expect((await metrics.instances(null, clock.now())).instances).toEqual([])
    expect(String(errors[0])).toContain('The instance could not be read')
  })

  test('says the instance stopped, once', async () => {
    const metrics = sampled()
    await sampler!.take()
    time += 1_000
    await Promise.all([sampler!.stop(), sampler!.stop()])
    expect((await metrics.instances(null, clock.now())).instances[0]).toMatchObject({ status: 'stopped', stoppedAt: '2026-01-01T10:00:06.000Z' })
  })
})
