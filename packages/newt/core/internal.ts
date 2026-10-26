// What other pieces of newt need from core and applications must not reach: this file
// is not a subpath of the package. Each export says which piece uses it.

/** The store's repositories mark an entity saved, and take the events it tracked. */
export { markPersisted } from './entity/mark-persisted'
export { takeEvents } from './entity/take-events'
/** And put it back as it was saved when that save rolls back. */
export { restoreSaved, savedState } from './entity/saved-state'

/** The runtime builds each context's invocations, and runs its jobs as a worker. */
export { Invocations } from './use-case/invocations'
export { inWorker } from './use-case/invocation-chain'
/** A subscription and the worker check a handler's queue by one rule. */
export { eventOfQueue } from './events/event-of-queue'
/** The worker runs its jobs by its context's clock. */
export { currentClock } from './clock/current-clock'

/** HTTP answers with the framework's messages: what a route that is not there says, and the like. */
export { message } from './messages/message'
