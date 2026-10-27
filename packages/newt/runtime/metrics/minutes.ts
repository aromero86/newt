import type { EventCount } from '../../core/metrics/event-count'
import type { CountedEvent } from './event-metrics'

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
