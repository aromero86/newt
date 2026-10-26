import type { DomainEvent } from '../../core'

/** The event as it is published: with its own id, a new one if it came with none. */
export function withId(event: DomainEvent): DomainEvent & { id: string } {
  if (event.id) return event as DomainEvent & { id: string }
  return { id: Bun.randomUUIDv7(), name: event.name, payload: event.payload, occurredAt: event.occurredAt }
}
