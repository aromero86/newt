import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import type { InstanceMinute, Instances, InstanceSample } from '../../core/metrics/instance-sample'
import type { QueueFlow, QueueFlows } from '../../core/metrics/queue-flow'
import type { UseCaseTiming, UseCaseTimings } from '../../core/metrics/use-case-timing'
import { instanceMinuteOf, instanceStateOf, type InstanceLast } from './instance-minutes'
import type { CountedEvent, Metrics, QueueFlowEntry, TimedCall } from './metrics'
import { addCall, addEntry, countKey, countOf, emptyFlow, emptyTiming, flowKey, flowOf, type Flow, MINUTE_MS, minuteOf, timingKey, timingOf, type Timing } from './minutes'

export type MemoryMetricsOptions = {
  /** How long a minute is kept for whoever monitors it to collect: a day by default. */
  keepMinutes?: number
  /** At most how many counts and timings are kept: the oldest minutes go first. */
  maxCounts?: number
  /** How often what came is told to those watching it live. */
  liveMs?: number
}

/**
 * An application's event counts, use case timings, queue flows and the samples of its
 * instance in its own memory: for one instance of it. What the
 * monitor has not collected when the process ends is lost; with several instances,
 * each would count only its own, so they take `RedisMetrics`.
 */
export class MemoryMetrics implements Metrics {

  /** Each minute's counts, by key. */
  private readonly minutes = new Map<string, Map<string, number>>()
  /** Each minute's timings, by key. */
  private readonly timings = new Map<string, Map<string, Timing>>()
  /** Each minute's queue flows, by key. */
  private readonly flows = new Map<string, Map<string, Flow>>()
  /** Each minute's samples, by instance. */
  private readonly samples = new Map<string, Map<string, InstanceSample[]>>()
  /** Each instance's last sample. */
  private readonly lasts = new Map<string, InstanceLast>()
  private readonly listeners = new Set<(counts: EventCount[]) => void>()
  private pending = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private enabled = false
  private kept = 0
  /** The minute it last forgot in: it forgets once a minute, not at every count. */
  private forgotIn = ''
  private readonly keepMinutes: number
  private readonly maxCounts: number
  private readonly liveMs: number

  constructor(options: MemoryMetricsOptions = {}) {
    this.keepMinutes = options.keepMinutes ?? 24 * 60
    this.maxCounts = options.maxCounts ?? 200_000
    this.liveMs = options.liveMs ?? 2_000
  }

  enable(): void {
    this.enabled = true
  }

  count(event: CountedEvent): void {
    if (!this.enabled) return
    const minute = minuteOf(event.at)
    const key = countKey(event)
    let counts = this.minutes.get(minute)
    if (!counts) this.minutes.set(minute, counts = new Map())
    if (!counts.has(key)) this.kept++
    counts.set(key, (counts.get(key) ?? 0) + 1)
    this.forgetIn(minute, event.at)
    if (this.listeners.size > 0) this.tellLive(`${minute}|${key}`)
  }

  time(call: TimedCall): void {
    if (!this.enabled) return
    const minute = minuteOf(call.at)
    const key = timingKey(call)
    let timings = this.timings.get(minute)
    if (!timings) this.timings.set(minute, timings = new Map())
    let timing = timings.get(key)
    if (!timing) {
      timings.set(key, timing = emptyTiming())
      this.kept++
    }
    addCall(timing, call)
    this.forgetIn(minute, call.at)
  }

  flow(entry: QueueFlowEntry): void {
    if (!this.enabled) return
    const minute = minuteOf(entry.at)
    const key = flowKey(entry)
    let flows = this.flows.get(minute)
    if (!flows) this.flows.set(minute, flows = new Map())
    let flow = flows.get(key)
    if (!flow) {
      flows.set(key, flow = emptyFlow())
      this.kept++
    }
    addEntry(flow, entry)
    this.forgetIn(minute, entry.at)
  }

  sample(sample: InstanceSample): void {
    if (!this.enabled) return
    const minute = minuteOf(sample.at)
    let instances = this.samples.get(minute)
    if (!instances) this.samples.set(minute, instances = new Map())
    let samples = instances.get(sample.instance)
    if (!samples) {
      instances.set(sample.instance, samples = [])
      this.kept++
    }
    samples.push(sample)
    // Its state is its newest sample, whatever order they came in.
    const last = this.lasts.get(sample.instance)
    if (!last || sample.at >= last.sample.at) this.lasts.set(sample.instance, { sample, stoppedAt: null })
    this.forgetIn(minute, sample.at)
  }

  async stopped(instance: string, at: Date): Promise<void> {
    const last = this.lasts.get(instance)
    if (last) last.stoppedAt = at.toISOString()
  }

  async instances(since: string | null, now: Date): Promise<Instances> {
    const until = minuteOf(now.getTime() - MINUTE_MS)
    const minutes: InstanceMinute[] = []
    for (const minute of [...this.samples.keys()].sort()) {
      if ((since !== null && minute <= since) || minute > until) continue
      for (const samples of this.samples.get(minute)!.values()) minutes.push(instanceMinuteOf(minute, samples))
    }
    return { instances: [...this.lasts.values()].map(last => instanceStateOf(last, now)), minutes, until }
  }

  async closedFlows(since: string | null, now: Date): Promise<QueueFlows> {
    const until = minuteOf(now.getTime() - MINUTE_MS)
    const flows: QueueFlow[] = []
    for (const minute of [...this.flows.keys()].sort()) {
      if ((since !== null && minute <= since) || minute > until) continue
      for (const [key, flow] of this.flows.get(minute)!) flows.push(flowOf(key, minute, flow))
    }
    return { flows, until }
  }

  async closedTimings(since: string | null, now: Date): Promise<UseCaseTimings> {
    const until = minuteOf(now.getTime() - MINUTE_MS)
    const timings: UseCaseTiming[] = []
    for (const minute of [...this.timings.keys()].sort()) {
      if ((since !== null && minute <= since) || minute > until) continue
      for (const [key, timing] of this.timings.get(minute)!) timings.push(timingOf(key, minute, timing))
    }
    return { timings, until }
  }

  async closed(since: string | null, now: Date): Promise<EventCounts> {
    const until = minuteOf(now.getTime() - MINUTE_MS)
    const counts: EventCount[] = []
    for (const minute of [...this.minutes.keys()].sort()) {
      if ((since !== null && minute <= since) || minute > until) continue
      for (const [key, count] of this.minutes.get(minute)!) counts.push(countOf(key, minute, count))
    }
    return { counts, until }
  }

  async live(listener: (counts: EventCount[]) => void): Promise<() => void> {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.listeners.clear()
  }

  /** What came, a few seconds' worth at once, to those watching. */
  private tellLive(key: string): void {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const counts = [...this.pending].map(([minuteKey, count]) => {
        const [minute, key] = [minuteKey.slice(0, minuteKey.indexOf('|')), minuteKey.slice(minuteKey.indexOf('|') + 1)]
        return countOf(key, minute, count)
      })
      this.pending = new Map()
      for (const listener of this.listeners) listener(counts)
    }, this.liveMs)
    this.timer.unref?.()
  }

  /** Forgets once a minute, or when there are too many: never at every count. */
  private forgetIn(minute: string, at: Date): void {
    if (minute === this.forgotIn && this.kept <= this.maxCounts) return
    this.forgotIn = minute
    this.forget(at.getTime())
  }

  /** Minutes too old, and the oldest ones while there are too many counts and timings. */
  private forget(now: number): void {
    const oldest = minuteOf(now - this.keepMinutes * MINUTE_MS)
    for (const [instance, last] of this.lasts) {
      if (minuteOf(last.sample.at) < oldest) this.lasts.delete(instance)
    }
    for (const kept of [this.minutes, this.timings, this.flows, this.samples] as Map<string, Map<string, unknown>>[]) {
      for (const [minute, each] of kept) {
        if (minute >= oldest) continue
        this.kept -= each.size
        kept.delete(minute)
      }
    }
    if (this.kept <= this.maxCounts) return
    // Too many still: the oldest go first. Rare, so it may sort.
    for (const minute of [...new Set([...this.minutes.keys(), ...this.timings.keys(), ...this.flows.keys(), ...this.samples.keys()])].sort()) {
      if (this.kept <= this.maxCounts) break
      this.kept -= (this.minutes.get(minute)?.size ?? 0) + (this.timings.get(minute)?.size ?? 0) + (this.flows.get(minute)?.size ?? 0) + (this.samples.get(minute)?.size ?? 0)
      this.minutes.delete(minute)
      this.timings.delete(minute)
      this.flows.delete(minute)
      this.samples.delete(minute)
    }
  }
}
