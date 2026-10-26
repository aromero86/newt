// newt/core: what an application builds its modules with, and the criteria its
// repositories find them by. Storage, the runtime of a context, its adapters and HTTP
// are subpaths of their own (newt/port-store, newt/repository, newt/runtime, newt/adapter-sqlite,
// newt/http…);
// anything not exported here is private.

// Modules, entities and use cases
export { Module } from './module/module'
export type { Ref } from './module/ref'
export type { RefFinder } from './module/ref-finder'
export { Entity } from './entity/entity'
export type { EntityInput } from './entity/entity-input'
export type { EntitySchema } from './entity/entity-schema'
export { InvalidEntity } from './entity/errors/invalid-entity'
export { UseCase } from './use-case/use-case.decorator'
export type { UseCaseOptions } from './use-case/use-case-options'
export type { WriteRule } from './use-case/write-rule'
export type { Invocations } from './use-case/invocations'

// Who is doing it
export type { Actor } from './context/actor'
export { currentActor } from './context/current-actor'
export { runAsActor } from './context/run-as-actor'
export { NoActor } from './context/errors/no-actor'
export { defineScope } from './scope/define-scope'
export type { Scope } from './scope/scope'

// Errors, and what they say
export { DomainError } from './errors/domain-error'
export { ValidationError } from './errors/validation-error'
export { UnauthorizedError } from './errors/unauthorized-error'
export { ForbiddenError } from './errors/forbidden-error'
export { NotFoundError } from './errors/not-found-error'
export { ConflictError } from './errors/conflict-error'
export { ConcurrencyConflict } from './errors/concurrency-conflict'
export { ReferenceNotFound } from './errors/reference-not-found'
export type { Messages } from './messages/messages'
export { setMessages } from './messages/set-messages'

// Events
export type { DomainEvent } from './events/domain-event'
export type { Json } from './events/json'
export type { DomainEventClass } from './events/domain-event-class'
export { DomainEventEmitter } from './events/domain-event-emitter'
export type { Subscription } from './events/subscription'
export { eventsOf, type EmittersOf } from './events/events-of'
export type { EventBus } from './events/event-bus'
export type { EventHandler } from './events/event-handler'
export type { EventPublisher } from './events/event-publisher'
export type { SubscribeOptions } from './events/subscribe-options'

// What to find, field by field, and the filters a client may send
export type { Criteria } from './criteria/criteria'
export type { Condition } from './criteria/condition'
export type { Operator } from './criteria/operator'
export { allOf } from './criteria/all-of'
export { isCondition } from './criteria/is-condition'
export type { CriteriaNode } from './criteria/criteria-node'
export { criteriaTree } from './criteria/criteria-tree'
export { matches } from './criteria/matches'
export { compare } from './criteria/compare'
export { defineFilter, type FilterLimits } from './criteria/filter/define-filter'
export type { Filter } from './criteria/filter/filter'
export type { FilterField } from './criteria/filter/filter-field'
export type { FilterNode } from './criteria/filter/filter-node'

// Pages of lists
export type { Page } from './pagination/page'
export type { PageRequest } from './pagination/page-request'
export { toPage } from './pagination/to-page'

// Value objects
export type { ValueObject } from './value-objects/value-object'
export { Email } from './value-objects/email/email'
export { InvalidEmail } from './value-objects/email/errors/invalid-email'
export { SecretToken } from './value-objects/secret-token/secret-token'
export { InvalidSecretToken } from './value-objects/secret-token/errors/invalid-secret-token'

// Observability
export type { Tracer } from './observability/tracer'
export type { Span } from './observability/span'
export type { SpanAttributes } from './observability/span-attributes'
export { NoopTracer } from './observability/noop-tracer'
