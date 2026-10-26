import type { DomainEvent } from './domain-event'

/** What hears an event on the bus: published, so it has its id. */
export type EventHandler = (event: DomainEvent & { id: string }) => void | Promise<void>
