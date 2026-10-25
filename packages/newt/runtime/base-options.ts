import type { Tracer, WriteRule } from '../core'
import type { Store } from '../store'
import type { JobQueueOptions } from './jobs/job-queue-options'

export type BaseOptions<S extends Store> = {
  /** The context's name: `auth`, `shop`… Every span of its invocations says it. */
  name: string
  /** Its store, opened and up to date. */
  store: S
  /** Who watches its invocations: none, by default. */
  tracer?: Tracer
  /** How its worker runs the jobs of `handler` subscriptions. */
  jobs?: Partial<JobQueueOptions>
  /** What a use case writing to another module outside a worker gets: a warning by default. */
  writeRule?: WriteRule
}
