import { RedisClient } from 'bun'
import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import type { InstanceMinute, Instances, InstanceSample } from '../../core/metrics/instance-sample'
import type { QueueFlow, QueueFlows } from '../../core/metrics/queue-flow'
import type { UseCaseTiming, UseCaseTimings } from '../../core/metrics/use-case-timing'
import { instanceMinuteOf, instanceStateOf, type InstanceLast } from './instance-minutes'
import type { CountedEvent, Metrics, QueueFlowEntry, TimedCall } from './metrics'
import { addCall, addEntry, addFlow, addTiming, countKey, countOf, emptyFlow, emptyTiming, flowKey, flowOf, type Flow, MINUTE_MS, minuteOf, timingKey, timingOf, type Timing } from './minutes'

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
  private pendingFlows = new Map<string, Map<string, Flow>>()
  /** This instance's samples of each minute not yet closed, by minute: each flush writes them whole, over what it wrote before. */
  private ownSamples = new Map<string, InstanceSample[]>()
  /** Its last sample, until a flush writes it. */
  private pendingLast: InstanceSample | null = null
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
    addCall(one, call)
    this.addTiming(minuteOf(call.at), timingKey(call), one)
  }

  flow(entry: QueueFlowEntry): void {
    if (!this.enabled) return
    const one = emptyFlow()
    addEntry(one, entry)
    this.addFlowAt(minuteOf(entry.at), flowKey(entry), one)
  }

  sample(sample: InstanceSample): void {
    if (!this.enabled) return
    const minute = minuteOf(sample.at)
    const samples = this.ownSamples.get(minute) ?? []
    samples.push(sample)
    this.ownSamples.set(minute, samples)
    // Its state is its newest sample, whatever order they came in.
    if (this.pendingLast === null || sample.at >= this.pendingLast.at) this.pendingLast = sample
  }

  /** What it sampled is written first: its stop comes after its last sample. */
  async stopped(instance: string, at: Date): Promise<void> {
    await this.flushSamples()
    const found = await this.redis.hget(this.key('i:now'), instance)
    if (found === null) return
    const last = JSON.parse(found) as InstanceLast
    await this.redis.hset(this.key('i:now'), { [instance]: JSON.stringify({ ...last, stoppedAt: at.toISOString() }) })
  }

  async instances(since: string | null, now: Date): Promise<Instances> {
    const until = minuteOf(now.getTime() - MINUTE_MS - this.flushMs - 1_000)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes: InstanceMinute[] = []
    for (const minute of await this.redis.zrangebyscore(this.key('i:minutes'), from, Date.parse(until))) {
      for (const samples of Object.values(await this.redis.hgetall(this.key(`i:${minute}`)))) {
        minutes.push(instanceMinuteOf(minute, (JSON.parse(samples) as InstanceSample[]).map(revive)))
      }
    }
    const lasts = Object.entries(await this.redis.hgetall(this.key('i:now'))).map(([instance, last]) => {
      const parsed = JSON.parse(last) as InstanceLast
      return { instance, last: { ...parsed, sample: revive(parsed.sample) } }
    })
    // One not seen for longer than minutes are kept is forgotten.
    const forgotten = lasts.filter(({ last }) => now.getTime() - last.sample.at.getTime() > this.keepSeconds * 1000)
    if (forgotten.length > 0) await this.redis.send('HDEL', [this.key('i:now'), ...forgotten.map(({ instance }) => instance)]).catch(() => undefined)
    return { instances: lasts.filter(each => !forgotten.includes(each)).map(({ last }) => instanceStateOf(last, now)), minutes, until }
  }

  async closedFlows(since: string | null, now: Date): Promise<QueueFlows> {
    const until = minuteOf(now.getTime() - MINUTE_MS - this.flushMs - 1_000)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes = await this.redis.zrangebyscore(this.key('q:minutes'), from, Date.parse(until))
    const flows: QueueFlow[] = []
    for (const minute of minutes) {
      const byKey = new Map<string, Flow>()
      for (const [field, value] of Object.entries(await this.redis.hgetall(this.key(`q:${minute}`)))) {
        // `<key>#published`, `#delivered`, `#redelivered`, `#dead` and `#w<bucket>`: the last `#` ends the key.
        const at = field.lastIndexOf('#')
        const key = field.slice(0, at)
        const part = field.slice(at + 1)
        let flow = byKey.get(key)
        if (!flow) byKey.set(key, flow = emptyFlow())
        if (part === 'published' || part === 'delivered' || part === 'redelivered' || part === 'dead') flow[part] = Number(value)
        else flow.wait.set(Number(part.slice(1)), Number(value))
      }
      for (const [key, flow] of byKey) flows.push(flowOf(key, minute, flow))
    }
    return { flows, until }
  }

  async closedTimings(since: string | null, now: Date): Promise<UseCaseTimings> {
    const until = minuteOf(now.getTime() - MINUTE_MS - this.flushMs - 1_000)
    const from = since === null ? '-inf' : `(${Date.parse(since)}`
    const minutes = await this.redis.zrangebyscore(this.key('uc:minutes'), from, Date.parse(until))
    const timings: UseCaseTiming[] = []
    for (const minute of minutes) {
      const byKey = new Map<string, Timing>()
      for (const [field, value] of Object.entries(await this.redis.hgetall(this.key(`uc:${minute}`)))) {
        // `<key>#calls`, `#retries`, `#us` (microseconds, whole), `#b<bucket>`, and `#e:<code>`, `#f:<code>`
        // with the code URI-encoded: none has a `#` of its own, so the last one is the key's end.
        const at = field.lastIndexOf('#')
        const key = field.slice(0, at)
        const part = field.slice(at + 1)
        let timing = byKey.get(key)
        if (!timing) byKey.set(key, timing = emptyTiming())
        if (part === 'calls') timing.calls = Number(value)
        else if (part === 'retries') timing.retries = Number(value)
        else if (part === 'us') timing.totalMs = Number(value) / 1000
        else if (part.startsWith('e:')) timing.errors.set(decodeURIComponent(part.slice(2)), Number(value))
        else if (part.startsWith('f:')) timing.failures.set(decodeURIComponent(part.slice(2)), Number(value))
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
    await this.flushSamples()
    await this.flushTimings()
    await this.flushFlows()
    if (this.pending.size === 0) return
    const pending = this.pending
    this.pending = new Map()
    const told: EventCount[] = []
    const writes: string[][] = []
    for (const [minute, counts] of pending) {
      const hash = this.key(minute)
      for (const [key, count] of counts) {
        writes.push(['HINCRBY', hash, key, String(count)])
        told.push(countOf(key, minute, count))
      }
      writes.push(['EXPIRE', hash, String(this.keepSeconds)], ['ZADD', this.key('minutes'), String(Date.parse(minute)), minute])
    }
    const outcome = await this.apply('counts', writes)
    if (outcome === 'not applied') this.putBack('counts', pending, count => count, (minute, key, count) => this.add(minute, key, count))
    if (outcome !== 'applied') return
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
    const writes: string[][] = []
    for (const [minute, timings] of pending) {
      const hash = this.key(`uc:${minute}`)
      for (const [key, timing] of timings) {
        writes.push(
          ['HINCRBY', hash, `${key}#calls`, String(timing.calls)],
          ['HINCRBY', hash, `${key}#retries`, String(timing.retries)],
          ['HINCRBY', hash, `${key}#us`, String(Math.round(timing.totalMs * 1000))],
          ...[...timing.histogram].map(([bucket, count]) => ['HINCRBY', hash, `${key}#b${bucket}`, String(count)]),
          ...[...timing.errors].map(([code, count]) => ['HINCRBY', hash, `${key}#e:${encodeURIComponent(code)}`, String(count)]),
          ...[...timing.failures].map(([code, count]) => ['HINCRBY', hash, `${key}#f:${encodeURIComponent(code)}`, String(count)]),
        )
      }
      writes.push(['EXPIRE', hash, String(this.keepSeconds)], ['ZADD', this.key('uc:minutes'), String(Date.parse(minute)), minute])
    }
    const outcome = await this.apply('timings', writes)
    if (outcome === 'not applied') this.putBack('timings', pending, timing => timing.calls, (minute, key, timing) => this.addTiming(minute, key, timing))
    if (outcome !== 'applied') return
    await this.redis.send('ZREMRANGEBYSCORE', [this.key('uc:minutes'), '-inf', String(Math.max(...[...pending.keys()].map(minute => Date.parse(minute))) - this.keepSeconds * 1000)]).catch(() => undefined)
  }

  private async flushFlows(): Promise<void> {
    if (this.pendingFlows.size === 0) return
    const pending = this.pendingFlows
    this.pendingFlows = new Map()
    const writes: string[][] = []
    for (const [minute, flows] of pending) {
      const hash = this.key(`q:${minute}`)
      for (const [key, flow] of flows) {
        for (const part of ['published', 'delivered', 'redelivered', 'dead'] as const) {
          if (flow[part] > 0) writes.push(['HINCRBY', hash, `${key}#${part}`, String(flow[part])])
        }
        for (const [bucket, count] of flow.wait) writes.push(['HINCRBY', hash, `${key}#w${bucket}`, String(count)])
      }
      writes.push(['EXPIRE', hash, String(this.keepSeconds)], ['ZADD', this.key('q:minutes'), String(Date.parse(minute)), minute])
    }
    const outcome = await this.apply('queue flows', writes)
    if (outcome === 'not applied') this.putBack('queue flows', pending, flow => flow.published + flow.delivered + flow.redelivered + flow.dead, (minute, key, flow) => this.addFlowAt(minute, key, flow))
    if (outcome !== 'applied') return
    await this.redis.send('ZREMRANGEBYSCORE', [this.key('q:minutes'), '-inf', String(Math.max(...[...pending.keys()].map(minute => Date.parse(minute))) - this.keepSeconds * 1000)]).catch(() => undefined)
  }

  /**
   * A batch of increments as one MULTI/EXEC: Redis runs it whole or not at all, so it is never added twice.
   * `not applied` when Redis surely took none of it, and it may wait for the next flush; `unknown` when the
   * connection failed with it sent, and it is dropped: losing a batch is better than counting it twice.
   */
  private async apply(what: string, writes: string[][]): Promise<'applied' | 'not applied' | 'unknown'> {
    try {
      // Connected first: what the client cannot send then, Redis never had.
      if (!this.redis.connected) await this.redis.connect()
    } catch (error) {
      console.error(`[newt metrics] Redis is unreachable, the ${what} wait: ${(error as Error).message}`)
      return 'not applied'
    }
    // Sent in one go, without an await between them: nothing else this client sends comes inside the transaction.
    const sent = [this.redis.send('MULTI', []), ...writes.map(([name, ...args]) => this.redis.send(name!, args))]
    const exec = this.redis.send('EXEC', [])
    // Whatever fails among them, EXEC tells.
    for (const each of sent) each.catch(() => undefined)
    let results: unknown
    try {
      results = await exec
    } catch (error) {
      // An error reply to EXEC (EXECABORT) means Redis discarded the transaction; any other failure leaves it unknown.
      if ((error as { code?: string }).code === 'ERR_REDIS_SERVER_ERROR') {
        console.error(`[newt metrics] Redis did not take the ${what}, they wait: ${(error as Error).message}`)
        return 'not applied'
      }
      console.error(`[newt metrics] Redis may have taken the ${what} or not, they are dropped rather than counted twice: ${(error as Error).message}`)
      return 'unknown'
    }
    // A key the connection watched changed: Redis discarded it.
    if (results === null) return 'not applied'
    const failed = (results as unknown[]).filter(result => result instanceof Error)
    if (failed.length > 0) console.error(`[newt metrics] Redis refused ${failed.length} of the ${what}' writes, the rest are added: ${failed[0]!.message}`)
    return 'applied'
  }

  /** A batch Redis did not take waits for the next flush, but only its minutes still kept: older ones are dropped, and said. */
  private putBack<T>(what: string, batch: Map<string, Map<string, T>>, size: (value: T) => number, add: (minute: string, key: string, value: T) => void): void {
    const oldest = Date.now() - this.keepSeconds * 1000
    let dropped = 0
    for (const [minute, values] of batch) {
      for (const [key, value] of values) {
        if (Date.parse(minute) < oldest) dropped += size(value)
        else add(minute, key, value)
      }
    }
    if (dropped > 0) console.error(`[newt metrics] ${dropped} ${what} older than the minutes kept are dropped`)
  }

  /** Its minutes' samples, each minute whole under its own field, and its last sample as its state. */
  private async flushSamples(): Promise<void> {
    const last = this.pendingLast
    if (last === null) return
    this.pendingLast = null
    const writes: Promise<unknown>[] = [this.redis.hset(this.key('i:now'), { [last.instance]: JSON.stringify({ sample: last, stoppedAt: null }) })]
    for (const [minute, samples] of this.ownSamples) {
      const hash = this.key(`i:${minute}`)
      writes.push(
        this.redis.hset(hash, { [last.instance]: JSON.stringify(samples) }),
        this.redis.expire(hash, this.keepSeconds),
        this.redis.zadd(this.key('i:minutes'), Date.parse(minute), minute),
      )
    }
    try {
      await Promise.all(writes)
    } catch (error) {
      // Written again at the next flush, whole: nothing is lost but time.
      this.pendingLast ??= last
      console.error(`[newt metrics] Redis did not take the instance's samples, they wait: ${(error as Error).message}`)
      return
    }
    // Only the minute still open is written again; those before it are whole in Redis.
    const open = minuteOf(last.at)
    for (const minute of this.ownSamples.keys()) if (minute < open) this.ownSamples.delete(minute)
    await this.redis.send('ZREMRANGEBYSCORE', [this.key('i:minutes'), '-inf', String(Date.parse(open) - this.keepSeconds * 1000)]).catch(() => undefined)
  }

  private addFlowAt(minute: string, key: string, flow: Flow): void {
    let flows = this.pendingFlows.get(minute)
    if (!flows) this.pendingFlows.set(minute, flows = new Map())
    const kept = flows.get(key) ?? emptyFlow()
    addFlow(kept, flow)
    flows.set(key, kept)
  }

  private addTiming(minute: string, key: string, timing: Timing): void {
    let timings = this.pendingTimings.get(minute)
    if (!timings) this.pendingTimings.set(minute, timings = new Map())
    const kept = timings.get(key) ?? emptyTiming()
    addTiming(kept, timing)
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

/** A sample as JSON gives it back: its time a string again. */
function revive(sample: InstanceSample): InstanceSample {
  return { ...sample, at: new Date(sample.at) }
}
