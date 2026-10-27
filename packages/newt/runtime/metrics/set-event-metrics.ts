import type { EventMetrics } from './event-metrics'

/** Where the whole application counts its events, if it said: none until `setEventMetrics`. */
export const applicationMetrics: { value: EventMetrics | null } = { value: null }

/**
 * Where every context counts its events, as one: `RedisEventMetrics` when several
 * instances share the work, so they sum in one place. Set once, where the application
 * starts, before its contexts open; a context's own `metrics` (`BaseOptions`) goes
 * before it. Unset, each context counts in its own memory.
 */
export function setEventMetrics(metrics: EventMetrics): void {
  applicationMetrics.value = metrics
}
