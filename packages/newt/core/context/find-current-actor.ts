import type { Actor } from './actor'
import { actorScope } from './actor-scope'

/**
 * Who is doing the work in progress, if anyone: `undefined` outside a request, in a
 * worker, or on a public route nobody signed in to. For what anyone may do and a
 * signed-in person sees more of.
 */
export function findCurrentActor(): Actor | undefined {
  return actorScope.find()
}
