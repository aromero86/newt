import type { BunRequest } from 'bun'

/**
 * A route reads the request, calls a use case and returns its result. Nothing else.
 * Its path types its params: `/things/:id` gives `request.params.id`.
 */
export type HttpRoute<Path extends string = string> = (request: BunRequest<Path>) => Response | Promise<Response>
