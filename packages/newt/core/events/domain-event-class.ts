import type { DomainEvent } from './domain-event'
import type { Json } from './json'

export type DomainEventClass<TPayload extends Json> = {
  readonly eventName: string
  new(payload: TPayload): DomainEvent<TPayload>
}
