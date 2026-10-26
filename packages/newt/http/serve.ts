import type { Server } from 'bun'
import type { HttpRouter } from './http-router'
import { serveFrontend } from './serve-frontend'
import type { ServeOptions } from './serve-options'
import { toErrorResponse } from './to-error-response'

/**
 * A server for a context: its router's routes, the ones beside them, and its frontend
 * or a 404. Whatever throws outside a route (a route beside the router's) is the same
 * 500 a route gives, never Bun's page with the source, unless `development` asks for it.
 */
export function serve(options: ServeOptions): Server<undefined> {
  const development = options.development ?? false
  return Bun.serve({
    port: options.port,
    development,
    routes: { ...options.router.routes(), ...options.routes },
    fetch: options.frontend ? serveFrontend(options.frontend) : () => new Response('Not found', { status: 404 }),
    // In development Bun's own page answers instead, with the source.
    ...(development ? {} : { error: toErrorResponse }),
  })
}
