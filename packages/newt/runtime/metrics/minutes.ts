import type { EventCount } from '../../core/metrics/event-count'
import type { UseCaseTiming } from '../../core/metrics/use-case-timing'
import type { CountedEvent, TimedCall } from './metrics'

export const MINUTE_MS = 60_000

/** The start of the minute a time is in, ISO. */
export function minuteOf(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime()
  return new Date(ms - (ms % MINUTE_MS)).toISOString()
}

/** What tells one count from another in a minute: its context, event, scopes and actor. */
export function countKey(event: Pick<CountedEvent, 'context' | 'event' | 'scopes' | 'actor'>): string {
  const scopes = Object.entries(event.scopes).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([event.context, event.event, scopes, event.actor])
}

/** A count from its key, its minute and how many. */
export function countOf(key: string, minute: string, count: number): EventCount {
  const [context, event, scopes, actor] = JSON.parse(key) as [string, string, [string, string][], string | null]
  return { minute, context, event, scopes: Object.fromEntries(scopes), actor, count }
}

/** What tells one timing from another in a minute: its context, use case, scopes and actor. */
export function timingKey(call: Pick<TimedCall, 'context' | 'useCase' | 'scopes' | 'actor'>): string {
  const scopes = Object.entries(call.scopes).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([call.context, call.useCase, scopes, call.actor])
}

/** A minute's timing of one key, as it adds up. */
export type Timing = { calls: number, retries: number, totalMs: number, histogram: Map<number, number> }

export function emptyTiming(): Timing {
  return { calls: 0, retries: 0, totalMs: 0, histogram: new Map() }
}

/** A timing from its key, its minute and what it added up to. */
export function timingOf(key: string, minute: string, timing: Timing): UseCaseTiming {
  const [context, useCase, scopes, actor] = JSON.parse(key) as [string, string, [string, string][], string | null]
  return {
    minute, context, useCase, scopes: Object.fromEntries(scopes), actor,
    calls: timing.calls, retries: timing.retries, totalMs: timing.totalMs,
    histogram: Object.fromEntries([...timing.histogram].map(([bucket, count]) => [String(bucket), count])),
  }
}
