import { AsyncLocalStorage } from 'node:async_hooks'
import type { Actor } from './actor'

/** Where the actor of the request in progress lives. Only the actor functions use it. */
export const actorStorage = new AsyncLocalStorage<Actor>()
