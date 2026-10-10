import type { BunRequest } from 'bun'

/** A route reads the request, calls a use case and returns its result. Nothing else. */
export type HttpRoute = (request: BunRequest) => Response | Promise<Response>
