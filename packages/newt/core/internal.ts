// What other pieces of newt need from core and applications must not reach: this file
// is not a subpath of the package. Each export says which piece uses it.

/** The store's repositories mark an entity saved, and take the events it tracked. */
export { markPersisted } from './entity/mark-persisted'
export { takeEvents } from './entity/take-events'

/** The runtime builds each context's invocations, and runs its jobs as a worker. */
export { Invocations } from './use-case/invocations'
export { inWorker } from './use-case/invocation-chain'
