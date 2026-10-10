import type { Actor } from './actor'
import { actorStorage } from './actor-storage'

/** Runs `fn` with `actor` as the one doing it, down to every use case it calls. */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
  return actorStorage.run(actor, fn)
}
