import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import type { CountedEvent, EventMetrics } from './event-metrics'
import { countKey, countOf, MINUTE_MS, minuteOf } from './minutes'

export type MemoryEventMetricsOptions = {
  /** How long a minute is kept for whoever monitors it to collect: a day by default. */
  keepMinutes?: number
  /** At most how many counts are kept: the oldest minutes go first. */
  maxCounts?: number
  /** How often what came is told to those watching it live. */
  liveMs?: number
}

/**
 * An application's event counts in its own memory: for one instance of it. What the
 * monitor has not collected when the process ends is lost; with several instances,
 * each would count only its own, so they take `RedisEventMetrics`.
 */
export class MemoryEventMetrics implements EventMetrics {

  /** Each minute's counts, by key. */
  private readonly minutes = new Map<string, Map<string, number>>()
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

  constructor(options: MemoryEventMetricsOptions = {}) {
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
    if (minute !== this.forgotIn || this.kept > this.maxCounts) {
      this.forgotIn = minute
      this.forget(event.at.getTime())
    }
    if (this.listeners.size > 0) this.tellLive(`${minute}|${key}`)
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

  /** Minutes too old, and the oldest ones while there are too many counts. */
  private forget(now: number): void {
    const oldest = minuteOf(now - this.keepMinutes * MINUTE_MS)
    for (const [minute, counts] of this.minutes) {
      if (minute >= oldest) continue
      this.kept -= counts.size
      this.minutes.delete(minute)
    }
    if (this.kept <= this.maxCounts) return
    // Too many still: the oldest go first. Rare, so it may sort.
    for (const minute of [...this.minutes.keys()].sort()) {
      if (this.kept <= this.maxCounts) break
      this.kept -= this.minutes.get(minute)!.size
      this.minutes.delete(minute)
    }
  }
}
