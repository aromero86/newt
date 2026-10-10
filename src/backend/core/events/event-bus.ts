import type { EventHandler } from './event-handler'
import type { EventPublisher } from './event-publisher'

export interface EventBus extends EventPublisher {
  subscribe(pattern: string, handler: EventHandler): () => void
}
