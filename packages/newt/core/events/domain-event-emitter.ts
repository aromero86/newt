import type { DomainEvent } from './domain-event'
import type { DomainEventClass } from './domain-event-class'
import type { EventBus } from './event-bus'
import type { EventMeta } from './event-meta'
import { eventOfQueue } from './event-of-queue'
import type { Json } from './json'
import type { Subscription } from './subscription'

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

  /**
   * Runs `handler` after each commit that tells the event, as `subscription` says, with
   * its payload and what else it knows of it (`meta`): its id, its name, when it happened.
   */
  subscribe<TSeen extends TPayload = TPayload>(handler: (payload: TSeen, meta: EventMeta) => unknown, subscription: Subscription<TPayload, TSeen>): () => void {
    const run = async ({ id, name, payload, occurredAt }: DomainEvent & { id: string }) => { await handler(payload as TSeen, { id, name, occurredAt }) }
    const takes = (event: DomainEvent) => subscription.when?.(event.payload as TPayload) ?? true
    if (subscription.strategy === 'fire-and-forget') return this.bus.subscribe(this.name, event => (takes(event) ? run(event) : undefined))

    const { queue, attempts } = subscription
    if (eventOfQueue(queue) !== this.name) {
      throw new Error(`A handler's queue is '<module>.<use case>.on.${this.name}': '${queue}' is not`)
    }
    return this.bus.subscribe(this.name, run, { mode: 'handler', name: queue, attempts, when: subscription.when && takes })
  }
}
