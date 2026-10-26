import type { Actor } from './actor'
import { actorScope } from './actor-scope'

/** Runs `fn` with `actor` as the one doing it, down to every use case it calls. */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
  return actorScope.run(actor, fn)
}
