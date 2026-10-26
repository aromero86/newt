import type { DomainEventEmitter } from './domain-event-emitter'
import type { Json } from './json'

/**
 * What a module needs of an event it reacts to: to subscribe to it, nothing more. A
 * port in its deps says so (`deleted: EventSource<{ id: string }>`), and another
 * module's emitter fits it, or whatever a test hands.
 */
export type EventSource<TPayload extends Json> = Pick<DomainEventEmitter<TPayload>, 'subscribe'>
