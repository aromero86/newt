import type { BunRequest } from 'bun'
import type { Actor } from '../../core/context/actor'

/** Tells who sent a request, from its session; `null` when nobody is signed in. */
export type Authenticator = (request: BunRequest) => Promise<Actor | null>
