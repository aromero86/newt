import type { EventCount, EventCounts } from '../../core/metrics/event-count'
import type { Outcome } from '../../core/metrics/outcome'
import type { QueueFlows } from '../../core/metrics/queue-flow'
import type { UseCaseTimings } from '../../core/metrics/use-case-timing'

/** An event told, as it is counted: in which context, scopes and minute, and by whom. */
export type CountedEvent = { context: string, event: string, scopes: Record<string, string>, actor: string | null, at: Date }

/** A use case's call, as it is timed: in which context, scopes and minute, by whom, how long, and how many runs more. */
export type TimedCall = {
  context: string
  useCase: string
  scopes: Record<string, string>
  actor: string | null
  at: Date
  ms: number
  retries: number
  /** How it ended, if it threw: null for a call that went well. */
  outcome?: Outcome | null
}

/** What happened to one job of a queue: published, or taken and then delivered, redelivered or dead, after waiting. */
export type QueueFlowEntry = {
  context: string
  queue: string
  kind: 'published' | 'delivered' | 'redelivered' | 'dead'
  at: Date
  /** How long it waited, ready, before a worker took it: none for one published. */
  waitMs?: number
}

/**
 * Where an application counts its events and times its use cases' calls, minute by
 * minute, for whoever monitors it
 * (`serveMonitor`, which turns it on): in its own memory (`MemoryMetrics`, one
 * instance) or in Redis (`RedisMetrics`, any number of them, which sum in one place).
 * Counting never writes to the application's store.
 */
export interface Metrics {
  /** Starts counting: until then, `count` does nothing. */
  enable(): void
  count(event: CountedEvent): void
  time(call: TimedCall): void
  flow(entry: QueueFlowEntry): void
  /** The counts of the minutes closed after `since` (every one kept, if null), and up to which minute. */
  closed(since: string | null, now: Date): Promise<EventCounts>
  /** The use cases' timings of the minutes closed after `since`, and up to which minute. */
  closedTimings(since: string | null, now: Date): Promise<UseCaseTimings>
  /** The queues' flows of the minutes closed after `since`, and up to which minute. */
  closedFlows(since: string | null, now: Date): Promise<QueueFlows>
  /** Counts as they come, a few seconds apart, from every instance: for watching it live. */
  live(listener: (counts: EventCount[]) => void): Promise<() => void>
  close(): Promise<void>
}
