// newt/runtime: a context at runtime. Its Base gives every module the store, the
// invocations of its use cases, the event bus and the jobs of its handlers; a
// BoundedContext starts and stops it.

export { Base } from './base'
export type { BaseOptions } from './base-options'
export { BoundedContext } from './bounded-context'
export type { JobQueue } from './jobs/job-queue'
export type { JobQueueOptions } from './jobs/job-queue-options'
