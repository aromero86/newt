import type { DomainEventClass } from './domain-event-class'
import { DomainEventEmitter } from './domain-event-emitter'
import type { EventBus } from './event-bus'

/** One emitter for each event class, each typed with its payload. */
export type EmittersOf<Classes> = {
  readonly [K in keyof Classes]: Classes[K] extends DomainEventClass<infer Payload> ? DomainEventEmitter<Payload> : never
}

/**
 * The events a module tells, as emitters others react to:
 *
 * ```ts
 * this.events = eventsOf(base.bus, { placed: Order_Placed, confirmed: Order_Confirmed })
 * // elsewhere: orders.events.placed
 * ```
 */
export function eventsOf<Classes extends Record<string, DomainEventClass<any>>>(bus: EventBus, classes: Classes): EmittersOf<Classes> {
  return Object.fromEntries(Object.entries(classes).map(([key, eventClass]) => [key, new DomainEventEmitter(bus, eventClass)])) as EmittersOf<Classes>
}
