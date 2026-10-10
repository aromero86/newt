import type { Actor } from './actor'
import { actorStorage } from './actor-storage'
import { NoActor } from './errors/no-actor'

/** Who is doing the work in progress. Throws when nobody is signed in. */
export function currentActor(): Actor {
  const actor = actorStorage.getStore()
  if (!actor) throw new NoActor()
  return actor
}
