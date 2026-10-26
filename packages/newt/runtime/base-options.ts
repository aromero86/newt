import type { Clock, Tracer, WriteRule } from '../core'
import type { Store } from '../port-store'
import type { JobQueueOptions } from './jobs/job-queue-options'

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
  /** Who watches its invocations: none, by default. */
  tracer?: Tracer
  /** How its worker runs the jobs of `handler` subscriptions. */
  jobs?: Partial<JobQueueOptions>
  /**
   * What a use case writing to another module outside a worker gets: an error by
   * default; `warn` while an application moves to the rule, `off` never.
   */
  writeRule?: WriteRule
}
