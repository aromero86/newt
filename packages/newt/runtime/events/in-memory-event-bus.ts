import { AsyncLocalStorage } from 'node:async_hooks'
import type { DomainEvent, EventBus, EventHandler } from '../../core'
import { eventNameMatches } from './event-name-matches'

export class InMemoryEventBus implements EventBus {

  private subscriptions: { pattern: string; handler: EventHandler }[] = []
  /**
   * The context it was made in, at startup: handlers run in it, never in the
   * publisher's. Like a job's, a handler inherits nothing of whatever published, not
   * its actor: it reacts on its own, with no actor but one it sets itself.
   */
  private readonly detached = AsyncLocalStorage.snapshot()

  publish(event: DomainEvent): void {
    for (const sub of this.subscriptions) {
      if (!eventNameMatches(sub.pattern, event.name)) {
        continue
      }
      Promise.resolve()
        .then(() => this.detached(() => sub.handler(event)))
        .catch(err => console.error(`[EventBus] handler error for '${event.name}':`, err))
    }
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    const sub = { pattern, handler }
    this.subscriptions.push(sub)
    return () => { this.subscriptions = this.subscriptions.filter(s => s !== sub) }
  }

}
