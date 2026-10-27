import type { Clock, GuardRule, Tracer, WriteRule } from '../core'
import type { Store } from '../port-store'
import type { JobQueueOptions } from './jobs/job-queue-options'
import type { EventMetrics } from './metrics/event-metrics'

export type BaseOptions<S extends Store> = {
  /** The context's name: `auth`, `shop`… Every span of its invocations says it. */
  name: string
  /** Its store, opened and up to date. */
  store: S
  /**
   * What tells it the time: when its entities are created and changed, when its jobs
   * are due, when its schedules fire. The real time by default; a test's moves.
   */
  clock?: Clock
  /** Who watches its invocations, if not the application's tracer (`setTracer`). */
  tracer?: Tracer
  /** How its worker runs the jobs of `handler` subscriptions. */
  jobs?: Partial<JobQueueOptions>
  /**
   * What a use case writing to another module outside a worker, or saving a second
   * module in one transaction, gets: an error by default; `warn` while an application
   * moves to the rule, `off` never.
   */
  writeRule?: WriteRule
  /**
   * What a save that guards nothing and reads other rows in its transaction gets: an
   * error by default; `warn` while an application adds its guards, `off` never.
   */
  guardRule?: GuardRule
  /**
   * Where it counts its events for whoever monitors it: the application's
   * (`setEventMetrics`), else its own memory (one instance); `RedisEventMetrics` when
   * several instances share the work. Counting starts once `serveMonitor` serves it.
   */
  metrics?: EventMetrics
}
