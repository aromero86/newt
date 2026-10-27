import { defineScope } from '../scope/define-scope'
import type { Actor } from './actor'
import { NoActor } from './errors/no-actor'

/** Where the actor of the work in progress lives. Only the actor functions use it. */
export const actorScope = defineScope<Actor>('actor', { counted: false, missing: () => new NoActor() })
