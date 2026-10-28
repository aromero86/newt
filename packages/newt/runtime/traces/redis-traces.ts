import { RedisClient } from 'bun'
import type { ClosedTraces, Trace } from '../../core/traces/trace'
import { MINUTE_MS, minuteOf } from '../metrics/minutes'
import { keepChain, type HeldTraces } from './trace-chain'
import { pageOf, TRACES_PAGE, type Traces } from './traces'

export type RedisTracesOptions = {
  /** The Redis every instance shares: `redis://redis:6379`. */
  url: string
  /** What its keys start with, so several applications may share one Redis. */
  prefix?: string
  /** How long a minute's traces are kept for whoever monitors it to collect: an hour by default. */
  keepMinutes?: number
  /** At most how many traces a minute keeps, among every instance: the ones past it are left out. */
  maxPerMinute?: number
  /** How long a trace not kept is held, for one of its chain to keep it, from any instance: half an hour by default. */
  holdMinutes?: number
}

/** How long after a minute ends it is closed: what an instance was still writing to it has arrived. */
const SETTLE_MS = 5_000

/**
 * An application's traces in Redis, for any number of instances of it: each one adds
 * the traces it kept to the list of the minute they ended in, so the monitor collects
 * every instance's from whichever it reaches. A trace is written as it ends: they are
 * few, the ones that went wrong and a share of the rest. The ones held for their chain
 * are in Redis too, so a job that fails on one instance keeps the request another served.
 */
export class RedisTraces implements Traces {

  private readonly redis: RedisClient
  private readonly prefix: string
  private readonly keepSeconds: number
  private readonly maxPerMinute: number
  private readonly holdSeconds: number
  private readonly held: HeldTraces
  private readonly writing = new Set<Promise<unknown>>()

  constructor(options: RedisTracesOptions) {
    this.redis = new RedisClient(options.url)
    this.prefix = options.prefix ?? 'newt:traces'
    this.keepSeconds = (options.keepMinutes ?? 60) * 60
    this.maxPerMinute = options.maxPerMinute ?? 1_000
    this.holdSeconds = (options.holdMinutes ?? 30) * 60
    this.held = this.heldInRedis()
  }

  finished(trace: Trace, wanted: boolean): void {
    const write = keepChain(trace, wanted, this.held, kept => this.write(minuteOf(Date.now()), kept))
      .catch(error => console.error('[RedisTraces] a trace could not be kept:', error))
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

  /** The traces held and the events marked, as keys that expire on their own. */
  private heldInRedis(): HeldTraces {
    const ex = String(this.holdSeconds)
    const take = async (id: string) => {
      const json = await this.redis.send('GETDEL', [this.key(`held:${id}`)]) as string | null
      return json ? JSON.parse(json) as Trace : null
    }
    return {
      hold: async trace => {
        await this.redis.send('SET', [this.key(`held:${trace.id}`), JSON.stringify(trace), 'EX', ex])
        for (const event of trace.told) await this.redis.send('SET', [this.key(`teller:${event.id}`), trace.id, 'EX', ex])
        if (trace.job) {
          const caused = this.key(`caused:${trace.job.eventId}`)
          await this.redis.send('SADD', [caused, trace.id])
          await this.redis.expire(caused, this.holdSeconds)
        }
      },
      takeCaused: async eventId => {
        const caused = this.key(`caused:${eventId}`)
        const ids = await this.redis.send('SMEMBERS', [caused]) as string[]
        await this.redis.send('DEL', [caused])
        return (await Promise.all(ids.map(take))).filter(trace => trace !== null)
      },
      takeTeller: async eventId => {
        const id = await this.redis.send('GETDEL', [this.key(`teller:${eventId}`)]) as string | null
        return id ? take(id) : null
      },
      mark: async eventIds => {
        for (const id of eventIds) await this.redis.send('SET', [this.key(`kept:${id}`), '1', 'EX', ex])
      },
      isMarked: async eventId => (await this.redis.send('EXISTS', [this.key(`kept:${eventId}`)]) as number) === 1,
    }
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`
  }
}
