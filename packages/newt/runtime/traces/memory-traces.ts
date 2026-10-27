import type { ClosedTraces, Trace } from '../../core/traces/trace'
import { MINUTE_MS, minuteOf } from '../metrics/minutes'
import { pageOf, TRACES_PAGE, type Traces } from './traces'

export type MemoryTracesOptions = {
  /** How long a minute's traces are kept for whoever monitors it to collect: an hour by default. */
  keepMinutes?: number
  /** At most how many traces a minute keeps: the ones past it are left out. */
  maxPerMinute?: number
}

/**
 * An application's traces in its own memory: for one instance of it. What the monitor
 * has not collected when the process ends is lost; several instances take `RedisTraces`.
 */
export class MemoryTraces implements Traces {

  private readonly minutes = new Map<string, Trace[]>()
  private readonly keepMinutes: number
  private readonly maxPerMinute: number

  constructor(options: MemoryTracesOptions = {}) {
    this.keepMinutes = options.keepMinutes ?? 60
    this.maxPerMinute = options.maxPerMinute ?? 1_000
  }

  record(trace: Trace): void {
    const now = Date.now()
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
  }
}
