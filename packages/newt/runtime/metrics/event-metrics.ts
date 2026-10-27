import type { EventCount, EventCounts } from '../../core/metrics/event-count'

/** An event told, as it is counted: in which context, scopes and minute, and by whom. */
export type CountedEvent = { context: string, event: string, scopes: Record<string, string>, actor: string | null, at: Date }

/**
 * Where an application counts its events, minute by minute, for whoever monitors it
 * (`serveMonitor`, which turns it on): in its own memory (`MemoryEventMetrics`, one
 * instance) or in Redis (`RedisEventMetrics`, any number of them, which sum in one place).
 * Counting never writes to the application's store.
 */
export interface EventMetrics {
  /** Starts counting: until then, `count` does nothing. */
  enable(): void
  count(event: CountedEvent): void
  /** The counts of the minutes closed after `since` (every one kept, if null), and up to which minute. */
  closed(since: string | null, now: Date): Promise<EventCounts>
  /** Counts as they come, a few seconds apart, from every instance: for watching it live. */
  live(listener: (counts: EventCount[]) => void): Promise<() => void>
  close(): Promise<void>
}
