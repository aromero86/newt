import type { DomainEventClass } from './domain-event-class'
import type { EventBus } from './event-bus'

export class DomainEventEmitter<TPayload> {

  constructor(
    private readonly bus: EventBus,
    private readonly eventClass: DomainEventClass<TPayload>,
  ) { }

  get name(): string {
    return this.eventClass.eventName
  }

  subscribe(handler: (payload: TPayload) => void | Promise<void>): () => void {
    return this.bus.subscribe(this.eventClass.eventName, event => handler(event.payload as TPayload))
  }

}
