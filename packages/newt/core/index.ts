// newt/core: what an application builds its modules with. Storage, the runtime of a
// context, its adapters and HTTP are subpaths of their own (newt/store, newt/runtime,
// newt/adapter-sqlite, newt/http…); anything not exported here is private.

// Entities
export { Entity } from './entity/entity'
export type { EntityInput } from './entity/entity-input'
export type { EntitySchema } from './entity/entity-schema'

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
export type { DomainEventClass } from './events/domain-event-class'
export { DomainEventEmitter } from './events/domain-event-emitter'
export type { Subscription } from './events/subscription'
export { eventsOf, type EmittersOf } from './events/events-of'
export type { EventBus } from './events/event-bus'
export type { EventHandler } from './events/event-handler'
export type { EventPublisher } from './events/event-publisher'
export type { SubscribeOptions } from './events/subscribe-options'

// Pages of lists
export type { Page } from './pagination/page'
export type { PageRequest } from './pagination/page-request'
export { toPage } from './pagination/to-page'

// Value objects
export type { ValueObject } from './value-objects/value-object'
export { Email } from './value-objects/email/email'
export { InvalidEmail } from './value-objects/email/errors/invalid-email'
export { SecretToken } from './value-objects/secret-token/secret-token'

// Observability
export type { Tracer } from './observability/tracer'
export type { Span } from './observability/span'
export type { SpanAttributes } from './observability/span-attributes'
export { NoopTracer } from './observability/noop-tracer'
