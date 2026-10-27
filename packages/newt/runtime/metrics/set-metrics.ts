import type { Metrics } from './metrics'

/** Where the whole application counts its events, if it said: none until `setMetrics`. */
export const applicationMetrics: { value: Metrics | null } = { value: null }

/**
 * Where every context counts its events, as one: `RedisMetrics` when several
 * instances share the work, so they sum in one place. Set once, where the application
 * starts, before its contexts open; a context's own `metrics` (`BaseOptions`) goes
 * before it. Unset, each context counts in its own memory.
 */
export function setMetrics(metrics: Metrics): void {
  applicationMetrics.value = metrics
}
