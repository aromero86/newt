import type { DomainEvent } from './domain-event'

export type EventHandler = (event: DomainEvent) => void | Promise<void>
