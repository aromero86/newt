// newt-kit/port-outbox: the port a store implements to keep the jobs of `handler` subscriptions
// with its data, and the rule that fences a claimed job.

export type { Outbox } from './outbox'
export type { Job } from './job'
export type { JobClosing } from './job-closing'
export type { JobQuery } from './job-query'
export type { JobQueueRegistration } from './job-queue-registration'
export type { QueueDepth } from './queue-depth'
export { depthOf } from './queue-depth'
export { isSameClaim } from './is-same-claim'
