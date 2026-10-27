import { RedisClient } from 'bun'
import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import { histogramBucketOf } from '../../core/metrics/histogram'
import type { UseCaseTiming, UseCaseTimings } from '../../core/metrics/use-case-timing'
import type { CountedEvent, Metrics, TimedCall } from './metrics'
import { countKey, countOf, emptyTiming, MINUTE_MS, minuteOf, timingKey, timingOf, type Timing } from './minutes'

export type RedisMetricsOptions = {
  /** The Redis every instance shares: `redis://redis:6379`. */
  url: string
  /** What its keys start with, so several applications may share one Redis. */
  prefix?: string
  /** How often each instance adds what it counted to Redis, and tells it live. */
  flushMs?: number
  /** How long a minute is kept for whoever monitors it to collect: a day by default. */
  keepMinutes?: number
}

/**
 * An application's event counts and use case timings in Redis, for any number of instances of it: each one
 * counts in its memory and adds it to Redis every few seconds (`HINCRBY`), so they sum
 * in one place, and tells it on a channel, so whichever instance the monitor reaches
 * sees every instance's live. A minute is closed only once every instance has added to
 * it: after its end and one more flush.
 */
export class RedisMetrics implements Metrics {

  private readonly redis: RedisClient
  private readonly subscribers: RedisClient[] = []
  private pending = new Map<string, Map<string, number>>()
  private pendingTimings = new Map<string, Map<string, Timing>>()
  private readonly timer: ReturnType<typeof setInterval>
  private enabled = false
  private closing: Promise<void> | null = null
  private readonly prefix: string
  private readonly flushMs: number
  private readonly keepSeconds: number

  constructor(private readonly options: RedisMetricsOptions) {
    this.redis = new RedisClient(options.url)
    this.prefix = options.prefix ?? 'newt:metrics'
    this.flushMs = options.flushMs ?? 5_000
    this.keepSeconds = (options.keepMinutes ?? 24 * 60) * 60
    this.timer = setInterval(() => void this.flush(), this.flushMs)
    this.timer.unref?.()
  }

  enable(): void {
    this.enabled = true
  }

  count(event: CountedEvent): void {
    if (!this.enabled) return
    this.add(minuteOf(event.at), countKey(event), 1)
  }

  time(call: TimedCall): void {
    if (!this.enabled) return
    const one = emptyTiming()
    one.calls = 1
    one.retries = call.retries
    one.totalMs = call.ms
    one.histogram.set(histogramBucketOf(call.ms), 1)
    this.addTiming(minuteOf(call.at), timingKey(call), one)
  }

  async closedTimings(since: string | null, now: Date): Promise<UseCaseTimings> {
    const until = minuteOf(now.getTime() - MINUTE_MS - this.flushMs - 1_000)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes = await this.redis.zrangebyscore(this.key('uc:minutes'), from, Date.parse(until))
    const timings: UseCaseTiming[] = []
    for (const minute of minutes) {
      const byKey = new Map<string, Timing>()
      for (const [field, value] of Object.entries(await this.redis.hgetall(this.key(`uc:${minute}`)))) {
        // `<key>#calls`, `#retries`, `#us` (microseconds, whole) and `#b<bucket>`: a key never ends in one of them.
        const at = field.lastIndexOf('#')
        const key = field.slice(0, at)
        const part = field.slice(at + 1)
        let timing = byKey.get(key)
        if (!timing) byKey.set(key, timing = emptyTiming())
        if (part === 'calls') timing.calls = Number(value)
        else if (part === 'retries') timing.retries = Number(value)
        else if (part === 'us') timing.totalMs = Number(value) / 1000
        else timing.histogram.set(Number(part.slice(1)), Number(value))
      }
      for (const [key, timing] of byKey) timings.push(timingOf(key, minute, timing))
    }
    return { timings, until }
  }

  async closed(since: string | null, now: Date): Promise<EventCounts> {
    // Every instance flushes within flushMs: a minute is closed once that has passed after it.
    const until = minuteOf(now.getTime() - MINUTE_MS - this.flushMs - 1_000)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes = await this.redis.zrangebyscore(this.key('minutes'), from, Date.parse(until))
    const counts: EventCount[] = []
    for (const minute of minutes) {
      const found = await this.redis.hgetall(this.key(minute))
      for (const [key, count] of Object.entries(found)) counts.push(countOf(key, minute, Number(count)))
    }
    return { counts, until }
  }

  async live(listener: (counts: EventCount[]) => void): Promise<() => void> {
    const subscriber = new RedisClient(this.options.url)
    this.subscribers.push(subscriber)
    await subscriber.subscribe(this.key('live'), message => listener(JSON.parse(message) as EventCount[]))
    return () => {
      this.subscribers.splice(this.subscribers.indexOf(subscriber), 1)
      subscriber.close()
    }
  }

  /** What is pending added before it goes: a deployment loses no count. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      clearInterval(this.timer)
      await this.flush()
      for (const subscriber of this.subscribers) subscriber.close()
      this.redis.close()
    })()
    return this.closing
  }

  private async flush(): Promise<void> {
    await this.flushTimings()
    if (this.pending.size === 0) return
    const pending = this.pending
    this.pending = new Map()
    const told: EventCount[] = []
    const writes: Promise<unknown>[] = []
    for (const [minute, counts] of pending) {
      const hash = this.key(minute)
      for (const [key, count] of counts) {
        writes.push(this.redis.hincrby(hash, key, count))
        told.push(countOf(key, minute, count))
      }
      writes.push(this.redis.expire(hash, this.keepSeconds), this.redis.zadd(this.key('minutes'), Date.parse(minute), minute))
    }
    try {
      // All at once: Bun sends them in one pipeline.
      await Promise.all(writes)
    } catch (error) {
      // Redis did not take them: they wait for the next flush, with what comes meanwhile.
      for (const [minute, counts] of pending) {
        for (const [key, count] of counts) this.add(minute, key, count)
      }
      console.error(`[newt metrics] Redis did not take the counts, they wait: ${(error as Error).message}`)
      return
    }
    await Promise.all([
      // Older than the kept window, counted from the newest minute added.
      this.redis.send('ZREMRANGEBYSCORE', [this.key('minutes'), '-inf', String(Math.max(...[...pending.keys()].map(minute => Date.parse(minute))) - this.keepSeconds * 1000)]),
      this.redis.publish(this.key('live'), JSON.stringify(told)),
    ]).catch(() => undefined)
  }

  private async flushTimings(): Promise<void> {
    if (this.pendingTimings.size === 0) return
    const pending = this.pendingTimings
    this.pendingTimings = new Map()
    const writes: Promise<unknown>[] = []
    for (const [minute, timings] of pending) {
      const hash = this.key(`uc:${minute}`)
      for (const [key, timing] of timings) {
        writes.push(
          this.redis.hincrby(hash, `${key}#calls`, timing.calls),
          this.redis.hincrby(hash, `${key}#retries`, timing.retries),
          this.redis.hincrby(hash, `${key}#us`, Math.round(timing.totalMs * 1000)),
          ...[...timing.histogram].map(([bucket, count]) => this.redis.hincrby(hash, `${key}#b${bucket}`, count)),
        )
      }
      writes.push(this.redis.expire(hash, this.keepSeconds), this.redis.zadd(this.key('uc:minutes'), Date.parse(minute), minute))
    }
    try {
      await Promise.all(writes)
    } catch (error) {
      for (const [minute, timings] of pending) {
        for (const [key, timing] of timings) this.addTiming(minute, key, timing)
      }
      console.error(`[newt metrics] Redis did not take the timings, they wait: ${(error as Error).message}`)
      return
    }
    await this.redis.send('ZREMRANGEBYSCORE', [this.key('uc:minutes'), '-inf', String(Math.max(...[...pending.keys()].map(minute => Date.parse(minute))) - this.keepSeconds * 1000)]).catch(() => undefined)
  }

  private addTiming(minute: string, key: string, timing: Timing): void {
    let timings = this.pendingTimings.get(minute)
    if (!timings) this.pendingTimings.set(minute, timings = new Map())
    const kept = timings.get(key) ?? emptyTiming()
    kept.calls += timing.calls
    kept.retries += timing.retries
    kept.totalMs += timing.totalMs
    for (const [bucket, count] of timing.histogram) kept.histogram.set(bucket, (kept.histogram.get(bucket) ?? 0) + count)
    timings.set(key, kept)
  }

  private add(minute: string, key: string, count: number): void {
    let counts = this.pending.get(minute)
    if (!counts) this.pending.set(minute, counts = new Map())
    counts.set(key, (counts.get(key) ?? 0) + count)
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`
  }
}
