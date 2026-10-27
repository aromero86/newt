// newt/contract: what a backend and its clients share, and a browser may load: the
// value objects and the errors they throw, the filters a client may send, pages of
// lists, the body of an error, and what an application says it is made of
// (`describeApplication`). Nothing here keeps a scope (`node:async_hooks`), so
// a frontend imports it as it is. It is core's own files, those that run anywhere.

export { DomainError } from '../core/errors/domain-error'
export { ValidationError } from '../core/errors/validation-error'
export { UnauthorizedError } from '../core/errors/unauthorized-error'
export { ForbiddenError } from '../core/errors/forbidden-error'
export { NotFoundError } from '../core/errors/not-found-error'
export { ConflictError } from '../core/errors/conflict-error'
export type { ValueObject } from '../core/value-objects/value-object'
export { Email } from '../core/value-objects/email/email'
export { InvalidEmail } from '../core/value-objects/email/errors/invalid-email'
export { SecretToken } from '../core/value-objects/secret-token/secret-token'
export { InvalidSecretToken } from '../core/value-objects/secret-token/errors/invalid-secret-token'
export { defineFilter, type FilterLimits } from '../core/criteria/filter/define-filter'
export type { Filter } from '../core/criteria/filter/filter'
export type { FilterField } from '../core/criteria/filter/filter-field'
export type { FilterNode } from '../core/criteria/filter/filter-node'
export type { Page } from '../core/pagination/page'
export type { PageRequest } from '../core/pagination/page-request'
export type { ErrorBody } from '../core/errors/error-body'
export type {
  ApplicationDescription,
  ContextDescription,
  ModuleDescription,
  UseCaseDescription,
  EventDescription,
  ModuleDependency,
  SubscriptionDescription,
} from '../core/description/application-description'
export type { EventCount, EventCounts } from '../core/metrics/event-count'
export type { UseCaseTiming, UseCaseTimings } from '../core/metrics/use-case-timing'
export type { Outcome } from '../core/metrics/outcome'
export type { QueueFlow, QueueFlows } from '../core/metrics/queue-flow'
export type { DeadJob, DeadJobs, OutboxState, QueueState } from '../core/metrics/outbox-state'
export { histogramBucketMs, histogramBucketOf, histogramPercentile, HISTOGRAM_FLOOR_MS, HISTOGRAM_GROWTH } from '../core/metrics/histogram'
