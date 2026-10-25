import type { Server } from 'bun'
import type { HttpRouter } from './http-router'
import { serveFrontend } from './serve-frontend'
import type { ServeOptions } from './serve-options'

/** A server for a context: its router's routes, the ones beside them, and its frontend or a 404. */
export function serve(options: ServeOptions): Server<undefined> {
  return Bun.serve({
    port: options.port,
    routes: { ...options.router.routes(), ...options.routes },
    fetch: options.frontend ? serveFrontend(options.frontend) : () => new Response('Not found', { status: 404 }),
  })
}
