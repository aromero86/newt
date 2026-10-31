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
export type { Metrics, CountedEvent, QueueFlowEntry, TimedCall } from './metrics/metrics'
export { MemoryMetrics } from './metrics/memory-metrics'
export { setMetrics } from './metrics/set-metrics'
export type { MemoryMetricsOptions } from './metrics/memory-metrics'
export { RedisMetrics } from './metrics/redis-metrics'
export type { RedisMetricsOptions } from './metrics/redis-metrics'
export type { EventCount, EventCounts } from '../core/metrics/event-count'
export type { UseCaseTiming, UseCaseTimings } from '../core/metrics/use-case-timing'
export type { Outcome } from '../core/metrics/outcome'
export type { QueueFlow, QueueFlows } from '../core/metrics/queue-flow'
export type { InstanceMinute, Instances, InstanceSample, InstanceState, MeanMax, MeanMin, ProcessReading, ServerReading } from '../core/metrics/instance-sample'
export { LOST_AFTER_MS, SAMPLE_EVERY_MS } from '../core/metrics/instance-sample'
export type { DeadJob, DeadJobs, OutboxState, QueueState } from '../core/metrics/outbox-state'
export type { Traces } from './traces/traces'
export { MemoryTraces } from './traces/memory-traces'
export type { MemoryTracesOptions } from './traces/memory-traces'
export { RedisTraces } from './traces/redis-traces'
export type { RedisTracesOptions } from './traces/redis-traces'
export { setTraces, enableTraces } from './traces/set-traces'
export type { SetTracesOptions } from './traces/set-traces'
export type { ClosedTraces, SpanAttributeValue, SpanKind, Trace, TraceJob, TraceLog, TraceSpan, TracedEvent } from '../core/traces/trace'
export { histogramBucketMs, histogramBucketOf, histogramPercentile, HISTOGRAM_FLOOR_MS, HISTOGRAM_GROWTH } from '../core/metrics/histogram'
export type {
  ApplicationDescription,
  ContextDescription,
  ModuleDescription,
  UseCaseDescription,
  EventDescription,
  ModuleDependency,
  SubscriptionDescription,
} from '../core/description/application-description'
