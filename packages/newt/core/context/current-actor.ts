import type { Actor } from './actor'
import { actorScope } from './actor-scope'

/** Who is doing the work in progress. Throws when nobody is signed in. */
export function currentActor(): Actor {
  return actorScope.current()
}
