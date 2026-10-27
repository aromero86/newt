import { RedisClient } from 'bun'
import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import type { CountedEvent, EventMetrics } from './event-metrics'
import { countKey, countOf, MINUTE_MS, minuteOf } from './minutes'

export type RedisEventMetricsOptions = {
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
 * An application's event counts in Redis, for any number of instances of it: each one
 * counts in its memory and adds it to Redis every few seconds (`HINCRBY`), so they sum
 * in one place, and tells it on a channel, so whichever instance the monitor reaches
 * sees every instance's live. A minute is closed only once every instance has added to
 * it: after its end and one more flush.
 */
export class RedisEventMetrics implements EventMetrics {

  private readonly redis: RedisClient
  private readonly subscribers: RedisClient[] = []
  private pending = new Map<string, Map<string, number>>()
  private readonly timer: ReturnType<typeof setInterval>
  private enabled = false
  private closing: Promise<void> | null = null
  private readonly prefix: string
  private readonly flushMs: number
  private readonly keepSeconds: number

  constructor(private readonly options: RedisEventMetricsOptions) {
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

  private add(minute: string, key: string, count: number): void {
    let counts = this.pending.get(minute)
    if (!counts) this.pending.set(minute, counts = new Map())
    counts.set(key, (counts.get(key) ?? 0) + count)
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`
  }
}
