import type { EventPublisher, Invocations } from '../core'
import type { Store } from './store'

/** What a repository needs from its context: its store, and where to publish what entities tell. */
export type RepositoryBase<S extends Store = Store> = {
  readonly store: S
  readonly publisher: EventPublisher
  /** Its context's invocations, which check who writes to whom; none, nothing is checked. */
  readonly invocations?: Invocations
}
