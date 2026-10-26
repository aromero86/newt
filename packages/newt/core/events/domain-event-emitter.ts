import type { DomainEventClass } from './domain-event-class'
import type { EventBus } from './event-bus'
import type { Json } from './json'
import type { Subscription } from './subscription'

/** `<module>.<use case>.on.`, then the event's own name. */
const QUEUE = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*\.on\./

/**
 * One kind of event a module tells. Others react to it by subscribing, always saying
 * how (`Subscription`): durably, as a `handler`, or in memory, `fire-and-forget`.
 *
 * ```ts
 * deps.order.events.confirmed.subscribe(order => notifications.orderConfirmed(order), {
 *   strategy: 'handler',
 *   queue: 'notification.orderConfirmed.on.order.confirmed',
 * })
 * ```
 */
export class DomainEventEmitter<TPayload extends Json> {

  constructor(
    private readonly bus: EventBus,
    private readonly eventClass: DomainEventClass<TPayload>,
  ) {}

  /** The event's name: `order.placed`. */
  get name(): string {
    return this.eventClass.eventName
  }

  /** Runs `handler` after each commit that tells the event, as `subscription` says. */
  subscribe(handler: (payload: TPayload) => unknown, subscription: Subscription): () => void {
    const run = async (payload: TPayload) => { await handler(payload) }
    if (subscription.strategy === 'fire-and-forget') return this.bus.subscribe(this.name, event => run(event.payload as TPayload))

    const { queue, attempts } = subscription
    if (!QUEUE.test(queue) || !queue.endsWith(`.on.${this.name}`)) {
      throw new Error(`A handler's queue is '<module>.<use case>.on.${this.name}': '${queue}' is not`)
    }
    return this.bus.subscribe(this.name, event => run(event.payload as TPayload), { mode: 'handler', name: queue, attempts })
  }
}
