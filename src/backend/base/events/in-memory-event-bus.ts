import type { DomainEvent } from '../../core/events/domain-event'
import type { EventBus } from '../../core/events/event-bus'
import type { EventHandler } from '../../core/events/event-handler'

export class InMemoryEventBus implements EventBus {

  private subscriptions: { pattern: string; handler: EventHandler }[] = []

  publish(event: DomainEvent): void {
    for (const sub of this.subscriptions) {
      if (!this.matches(sub.pattern, event.name)) {
        continue
      }
      Promise.resolve()
        .then(() => sub.handler(event))
        .catch(err => console.error(`[EventBus] handler error for '${event.name}':`, err))
    }
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    const sub = { pattern, handler }
    this.subscriptions.push(sub)
    return () => { this.subscriptions = this.subscriptions.filter(s => s !== sub) }
  }

  private matches(pattern: string, name: string): boolean {
    if (pattern === name) return true
    if (pattern.endsWith('.*')) return name.startsWith(pattern.slice(0, -1)) // "rule.*" matches every rule event
    return false
  }

}
