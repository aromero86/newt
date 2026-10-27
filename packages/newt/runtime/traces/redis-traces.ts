import { RedisClient } from 'bun'
import type { ClosedTraces, Trace } from '../../core/traces/trace'
import { MINUTE_MS, minuteOf } from '../metrics/minutes'
import { endOf, pageOf, TRACES_PAGE, type Traces } from './traces'

export type RedisTracesOptions = {
  /** The Redis every instance shares: `redis://redis:6379`. */
  url: string
  /** What its keys start with, so several applications may share one Redis. */
  prefix?: string
  /** How long a minute's traces are kept for whoever monitors it to collect: an hour by default. */
  keepMinutes?: number
  /** At most how many traces a minute keeps, among every instance: the ones past it are left out. */
  maxPerMinute?: number
}

/** How long after a minute ends it is closed: what an instance was still writing to it has arrived. */
const SETTLE_MS = 5_000

/**
 * An application's traces in Redis, for any number of instances of it: each one adds
 * the traces it kept to the list of the minute they ended in, so the monitor collects
 * every instance's from whichever it reaches. A trace is written as it ends: they are
 * few, the ones that went wrong and a share of the rest.
 */
export class RedisTraces implements Traces {

  private readonly redis: RedisClient
  private readonly prefix: string
  private readonly keepSeconds: number
  private readonly maxPerMinute: number
  private readonly writing = new Set<Promise<unknown>>()

  constructor(options: RedisTracesOptions) {
    this.redis = new RedisClient(options.url)
    this.prefix = options.prefix ?? 'newt:traces'
    this.keepSeconds = (options.keepMinutes ?? 60) * 60
    this.maxPerMinute = options.maxPerMinute ?? 1_000
  }

  record(trace: Trace): void {
    const write = this.write(minuteOf(endOf(trace)), trace)
      .catch(error => console.error('[RedisTraces] a trace could not be written:', error))
      .finally(() => this.writing.delete(write))
    this.writing.add(write)
  }

  async closed(since: string | null, now: Date, limit = TRACES_PAGE): Promise<ClosedTraces> {
    const until = minuteOf(now.getTime() - MINUTE_MS - SETTLE_MS)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes = await this.redis.zrangebyscore(this.key('minutes'), from, Date.parse(until))
    const read: [string, string[]][] = []
    for (const minute of minutes) read.push([minute, await this.redis.send('LRANGE', [this.key(minute), '0', '-1']) as string[]])
    const page = pageOf(read, until, limit)
    return { traces: page.minutes.flatMap(([, traces]) => traces.map(each => JSON.parse(each) as Trace)), until: page.until }
  }

  /** Waits for the traces on their way, then lets Redis go. */
  async close(): Promise<void> {
    await Promise.all(this.writing)
    this.redis.close()
  }

  private async write(minute: string, trace: Trace): Promise<void> {
    const list = this.key(minute)
    const length = await this.redis.send('RPUSH', [list, JSON.stringify(trace)]) as number
    if (length > this.maxPerMinute) await this.redis.send('LTRIM', [list, '0', String(this.maxPerMinute - 1)])
    if (length === 1) {
      await Promise.all([
        this.redis.expire(list, this.keepSeconds),
        this.redis.zadd(this.key('minutes'), Date.parse(minute), minute),
        this.redis.send('ZREMRANGEBYSCORE', [this.key('minutes'), '-inf', String(Date.parse(minute) - this.keepSeconds * 1000)]),
      ])
    }
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`
  }
}
