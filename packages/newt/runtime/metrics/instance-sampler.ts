import { readFile, statfs } from 'node:fs/promises'
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { Clock } from '../../core'
import { SAMPLE_EVERY_MS, type InstanceSample, type ProcessReading, type ServerReading } from '../../core/metrics/instance-sample'
import type { Metrics } from './metrics'

export type InstanceSamplerOptions = {
  /** Which instance it is: a new id each time the process starts. */
  instance: string
  startedAt: string
  /** The paths whose file systems it watches: `/` unless told. */
  disks?: string[]
  clock: Clock
  /** How often it reads: `SAMPLE_EVERY_MS` unless a test says. */
  everyMs?: number
}

/** The sampler `serveMonitor` started, for `runContexts` to stop it before the metrics close: none until then. */
export const applicationSampler: { value: InstanceSampler | null } = { value: null }

/** The processors' time, as `/proc/stat` adds it up: busy and in all. */
type CpuTimes = { busy: number, total: number }

/**
 * Reads its own process and the server it runs on every `SAMPLE_EVERY_MS`, and gives
 * each reading to the application's metrics: for whoever monitors it to see every
 * instance and every server. Each reading of the processors and the event loop is of
 * the time since the one before.
 */
export class InstanceSampler {

  private readonly metrics: Metrics
  private readonly options: InstanceSamplerOptions
  private readonly disks: string[]
  /** How late the event loop ran what was due, in nanoseconds, since the last reading. */
  private readonly loop = monitorEventLoopDelay({ resolution: 10 })
  private timer: ReturnType<typeof setInterval> | null = null
  private cpu = process.cpuUsage()
  private cpuAt = performance.now()
  private serverCpu: CpuTimes | null = null
  private stopping: Promise<void> | null = null

  constructor(metrics: Metrics, options: InstanceSamplerOptions) {
    this.metrics = metrics
    this.options = options
    this.disks = options.disks ?? ['/']
  }

  /** Reads now, and every `everyMs` after. */
  start(): void {
    if (this.timer) return
    this.loop.enable()
    void this.take()
    this.timer = setInterval(() => void this.take(), this.options.everyMs ?? SAMPLE_EVERY_MS)
    this.timer.unref?.()
  }

  /** Stops reading, and says the instance stopped: once, however often it is called. Never throws: it is on the way out. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (this.timer) clearInterval(this.timer)
      this.loop.disable()
      try {
        await this.metrics.stopped(this.options.instance, this.options.clock.now())
      } catch (error) {
        // It will be taken for lost: nothing else is.
        console.error(`[newt metrics] The instance could not say it stopped: ${(error as Error).message}`)
      }
    })()
    return this.stopping
  }

  /** One reading, given to the metrics: a reading that fails is skipped, and said. */
  async take(): Promise<void> {
    try {
      const sample: InstanceSample = {
        instance: this.options.instance,
        pid: process.pid,
        startedAt: this.options.startedAt,
        at: this.options.clock.now(),
        process: this.readProcess(),
        server: await this.readServer(),
      }
      this.metrics.sample(sample)
    } catch (error) {
      console.error(`[newt metrics] The instance could not be read: ${(error as Error).message}`)
    }
  }

  private readProcess(): ProcessReading {
    const memory = process.memoryUsage()
    const now = performance.now()
    const cpu = process.cpuUsage(this.cpu)
    const elapsedMs = now - this.cpuAt
    this.cpu = process.cpuUsage()
    this.cpuAt = now
    // With no delay recorded yet its mean is NaN.
    const loopMeanMs = Number.isFinite(this.loop.mean) ? this.loop.mean / 1e6 : 0
    const loopMaxMs = this.loop.max / 1e6
    this.loop.reset()
    return {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      cpu: elapsedMs > 0 ? ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100 : 0,
      loopMeanMs,
      loopMaxMs,
    }
  }

  private async readServer(): Promise<ServerReading> {
    const load = loadavg()
    return {
      disks: await Promise.all(this.disks.map(async path => {
        const disk = await statfs(path)
        // `bavail`: what a process that is not root may still write.
        return { path, totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize }
      })),
      memory: { totalBytes: totalmem(), freeBytes: freemem() },
      cpu: { cores: availableParallelism(), load: [load[0]!, load[1]!, load[2]!], usage: await this.serverCpuUsage() },
    }
  }

  /** How busy the processors were since the last reading, from `/proc/stat`: null without it, or on the first reading. */
  private async serverCpuUsage(): Promise<number | null> {
    // Not with Bun.file: /proc says its files are empty, and Bun reads them so.
    const stat = await readFile('/proc/stat', 'utf8').catch(() => null)
    if (stat === null) return null
    // `cpu  user nice system idle iowait irq softirq steal …`: idle and iowait are the time it was not busy.
    const fields = stat.split('\n', 1)[0]!.trim().split(/\s+/).slice(1).map(Number)
    const total = fields.reduce((sum, value) => sum + value, 0)
    const now = { busy: total - (fields[3] ?? 0) - (fields[4] ?? 0), total }
    const before = this.serverCpu
    this.serverCpu = now
    if (before === null || now.total <= before.total) return null
    return ((now.busy - before.busy) / (now.total - before.total)) * 100
  }
}
