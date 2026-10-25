import type { EventHandler } from './event-handler'
import type { EventPublisher } from './event-publisher'
import type { SubscribeOptions } from './subscribe-options'

export interface EventBus extends EventPublisher {
  subscribe(pattern: string, handler: EventHandler, options?: SubscribeOptions): () => void
}
