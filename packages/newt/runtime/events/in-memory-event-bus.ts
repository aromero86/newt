import { AsyncLocalStorage } from 'node:async_hooks'
import type { DomainEvent, EventBus, EventHandler } from '../../core'
import { eventNameMatches } from './event-name-matches'
import { withId } from './with-id'

/**
 * No context at all: this module's, taken as it loads, before any request or script
 * enters a scope. Handlers run in it, never in the publisher's nor in that of
 * whatever made the bus (a context opened lazily, inside a request). Like a job's, a
 * handler inherits nothing of whatever published, not its actor: it reacts on its
 * own, with no actor but one it sets itself.
 */
const detached = AsyncLocalStorage.snapshot()

export class InMemoryEventBus implements EventBus {

  private subscriptions: { pattern: string; handler: EventHandler }[] = []

  publish(event: DomainEvent): void {
    const told = withId(event)
    for (const sub of this.subscriptions) {
      if (!eventNameMatches(sub.pattern, event.name)) {
        continue
      }
      Promise.resolve()
        .then(() => detached(() => sub.handler(told)))
        .catch(err => console.error(`[EventBus] handler error for '${event.name}':`, err))
    }
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    const sub = { pattern, handler }
    this.subscriptions.push(sub)
    return () => { this.subscriptions = this.subscriptions.filter(s => s !== sub) }
  }

}
