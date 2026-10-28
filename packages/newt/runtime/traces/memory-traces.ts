import type { Clock } from '../../core'
import type { ClosedTraces, Trace } from '../../core/traces/trace'
import { MINUTE_MS, minuteOf } from '../metrics/minutes'
import { keepChain, type HeldTraces } from './trace-chain'
import { pageOf, TRACES_PAGE, type Traces } from './traces'

export type MemoryTracesOptions = {
  /** How long a minute's traces are kept for whoever monitors it to collect: an hour by default. */
  keepMinutes?: number
  /** At most how many traces a minute keeps: the ones past it are left out. */
  maxPerMinute?: number
  /** How long a trace not kept is held, for one of its chain to keep it: half an hour by default. */
  holdMinutes?: number
  /** At most how many traces are held at once. */
  maxHeld?: number
  /** What tells it when a trace is kept, the minute it is collected in: the real time unless a test gives another. */
  clock?: Clock
}

/**
 * An application's traces in its own memory: for one instance of it. What the monitor
 * has not collected when the process ends is lost; several instances take `RedisTraces`.
 */
export class MemoryTraces implements Traces {

  private readonly minutes = new Map<string, Trace[]>()
  private readonly held: MemoryHeld
  private readonly keepMinutes: number
  private readonly maxPerMinute: number
  private readonly now: () => number

  constructor(options: MemoryTracesOptions = {}) {
    this.keepMinutes = options.keepMinutes ?? 60
    this.maxPerMinute = options.maxPerMinute ?? 1_000
    this.now = () => (options.clock ?? { now: () => new Date() }).now().getTime()
    this.held = new MemoryHeld((options.holdMinutes ?? 30) * MINUTE_MS, options.maxHeld ?? 5_000, this.now)
  }

  finished(trace: Trace, wanted: boolean): void {
    keepChain(trace, wanted, this.held, kept => this.record(kept))
      .catch(error => console.error('[MemoryTraces] a trace could not be kept:', error))
  }

  /** Keeps a trace, in the minute it is kept in: one kept late, with its chain, is collected all the same. */
  record(trace: Trace): void {
    const now = this.now()
    const minute = minuteOf(now)
    let traces = this.minutes.get(minute)
    if (!traces) {
      this.minutes.set(minute, traces = [])
      this.forget(now)
    }
    if (traces.length < this.maxPerMinute) traces.push(trace)
  }

  async closed(since: string | null, now: Date, limit = TRACES_PAGE): Promise<ClosedTraces> {
    const until = minuteOf(now.getTime() - MINUTE_MS)
    const minutes = [...this.minutes].filter(([minute]) => (since === null || minute > since) && minute <= until).sort(([a], [b]) => (a < b ? -1 : 1))
    const page = pageOf(minutes, until, limit)
    return { traces: page.minutes.flatMap(([, traces]) => traces), until: page.until }
  }

  async close(): Promise<void> {}

  /** Forgets the minutes past the ones it keeps: once a minute, as a new one starts. */
  private forget(now: number): void {
    const oldest = minuteOf(now - this.keepMinutes * MINUTE_MS)
    for (const minute of this.minutes.keys()) if (minute < oldest) this.minutes.delete(minute)
    this.held.forget()
  }
}

/** The traces held, and the events marked, in memory, each until its time is up. */
class MemoryHeld implements HeldTraces {

  private readonly traces = new Map<string, { trace: Trace, until: number }>()
  private readonly caused = new Map<string, Set<string>>()
  private readonly tellers = new Map<string, string>()
  private readonly marked = new Map<string, number>()

  constructor(private readonly holdMs = 30 * MINUTE_MS, private readonly max = 5_000, private readonly now: () => number = Date.now) {}

  async hold(trace: Trace): Promise<void> {
    if (this.traces.size >= this.max) return
    this.traces.set(trace.id, { trace, until: this.now() + this.holdMs })
    for (const event of trace.told) this.tellers.set(event.id, trace.id)
    if (trace.job) this.caused.set(trace.job.eventId, (this.caused.get(trace.job.eventId) ?? new Set()).add(trace.id))
  }

  async takeCaused(eventId: string): Promise<Trace[]> {
    const ids = this.caused.get(eventId) ?? new Set()
    this.caused.delete(eventId)
    return [...ids].map(id => this.take(id)).filter(trace => trace !== null)
  }

  async takeTeller(eventId: string): Promise<Trace | null> {
    const id = this.tellers.get(eventId)
    this.tellers.delete(eventId)
    return id ? this.take(id) : null
  }

  async mark(eventIds: string[]): Promise<void> {
    for (const id of eventIds) this.marked.set(id, this.now() + this.holdMs)
  }

  async isMarked(eventId: string): Promise<boolean> {
    return (this.marked.get(eventId) ?? 0) > this.now()
  }

  /** Lets go of what is past its time. */
  forget(): void {
    const now = this.now()
    for (const [id, held] of this.traces) if (held.until <= now) this.traces.delete(id)
    for (const [id, until] of this.marked) if (until <= now) this.marked.delete(id)
    for (const [eventId, id] of this.tellers) if (!this.traces.has(id)) this.tellers.delete(eventId)
    for (const [eventId, ids] of this.caused) {
      for (const id of ids) if (!this.traces.has(id)) ids.delete(id)
      if (ids.size === 0) this.caused.delete(eventId)
    }
  }

  private take(id: string): Trace | null {
    const held = this.traces.get(id)
    this.traces.delete(id)
    return held && held.until > this.now() ? held.trace : null
  }
}
