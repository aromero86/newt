import type { DomainEvent } from './domain-event'

export interface EventPublisher {
  publish(event: DomainEvent): void
}
