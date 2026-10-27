// newt/runtime: a context at runtime. Its Base gives every module the store, the
// invocations of its use cases, the event bus, the jobs of its handlers and its schedules; a
// BoundedContext starts and stops it.

export { Base } from './base'
export type { BaseOptions } from './base-options'
export { BoundedContext } from './bounded-context'
export type { JobQueue } from './jobs/job-queue'
export type { JobQueueOptions } from './jobs/job-queue-options'
export type { Schedules } from './schedules/schedules'
export type { ScheduleTick } from './schedules/schedule-tick'
export { describeApplication } from './description/describe-application'
export type { EventMetrics, CountedEvent } from './metrics/event-metrics'
export { MemoryEventMetrics } from './metrics/memory-event-metrics'
export type { MemoryEventMetricsOptions } from './metrics/memory-event-metrics'
export { RedisEventMetrics } from './metrics/redis-event-metrics'
export type { RedisEventMetricsOptions } from './metrics/redis-event-metrics'
export type { EventCount, EventCounts } from '../core/metrics/event-count'
export type {
  ApplicationDescription,
  ContextDescription,
  ModuleDescription,
  UseCaseDescription,
  EventDescription,
  ModuleDependency,
  SubscriptionDescription,
} from '../core/description/application-description'
