import type { DomainEvent } from './domain-event'

export type DomainEventClass<TPayload> = {
  readonly eventName: string
  new(payload: TPayload): DomainEvent<TPayload>
}
