import type { HTMLBundle, Server } from 'bun'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { noteClientIp } from './client-ip'
import { securityHeadersOf, withHeaders } from './security-headers'
import { serveFrontend } from './serve-frontend'
import type { ServeOptions } from './serve-options'
import { toErrorResponse } from './to-error-response'

/**
 * A server for a context: its router's routes, the ones beside them, its health if
 * asked, and its frontend or a 404. Whatever throws outside a route (a route beside
 * the router's) is the same 500 a route gives, never Bun's page with the source,
 * unless `development` asks for it. Every answer carries its security headers
 * (`securityHeaders`, `hsts`), unless it has its own.
 *
 * Its `stop()` says it is stopping first (its health a 503), goes on answering for
 * `drainMs`, then stops as Bun's does, waiting for the requests in progress.
 */
export function serve(options: ServeOptions): Server<undefined> {
  const development = options.development ?? false
  let stopping = false
  const health = options.health
    ? { [typeof options.health === 'string' ? options.health : '/api/health']: { GET: () => Response.json({ status: stopping ? 'stopping' : 'ok' }, { status: stopping ? 503 : 200 }) } }
    : {}
  const headers = securityHeadersOf(options.securityHeaders, options.hsts)
  const trustProxy = options.trustProxy ?? 0
  // Each request: where it came from noted (`clientIp`), and its answer with the security headers.
  const around = (handler: Handler): Handler => async (request, server) => {
    noteClientIp(request, server, trustProxy)
    return withHeaders(await handler(request, server), headers)
  }
  const frontend = typeof options.frontend === 'string' ? serveFrontend(options.frontend) : () => new Response('Not found', { status: 404 })
  const server = Bun.serve({
    port: options.port,
    development,
    routes: wrapped({ ...health, ...options.router.routes(), ...options.routes, ...sourceFrontend(options.frontend, options.publicFolder) }, around),
    fetch: around(frontend),
    // In development Bun's own page answers instead, with the source.
    ...(development ? {} : { error: (error: Error) => withHeaders(toErrorResponse(error), headers) }),
  })
  const stop = server.stop.bind(server)
  server.stop = async (closeActiveConnections?: boolean) => {
    stopping = true
    if (options.drainMs) await Bun.sleep(options.drainMs)
    return stop(closeActiveConnections)
  }
  return server
}

type Handler = (request: Request, server: Server<undefined>) => Response | Promise<Response>

/** Every route of the table that is a function, by method or not, run through `around`: files and bundles as they are. */
function wrapped(routes: Bun.Serve.Routes<undefined, string>, note: (handler: Handler) => Handler): Bun.Serve.Routes<undefined, string> {
  return Object.fromEntries(Object.entries(routes).map(([path, route]) => [path,
    typeof route === 'function' ? note(route as Handler)
      : isMethods(route) ? Object.fromEntries(Object.entries(route).map(([method, handler]) => [method, typeof handler === 'function' ? note(handler as Handler) : handler]))
        : route,
  ])) as Bun.Serve.Routes<undefined, string>
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'])

/** A route by method (`{ GET, POST }`), not a file, a bundle, a folder or a fixed answer. */
function isMethods(route: unknown): route is Record<string, unknown> {
  if (typeof route !== 'object' || route === null || route instanceof Response || route instanceof Blob) return false
  const keys = Object.keys(route)
  return keys.length > 0 && keys.every(key => METHODS.has(key))
}

/**
 * A frontend served from its sources: its `index.html` for every address no route takes
 * (Bun builds it as it serves it), and each file of its public folder by its address.
 */
function sourceFrontend(frontend: string | HTMLBundle | undefined, publicFolder: string | undefined): Record<string, HTMLBundle | Bun.BunFile> {
  if (frontend === undefined || typeof frontend === 'string') return {}
  const files = publicFolder
    ? readdirSync(publicFolder, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => join(entry.parentPath, entry.name))
    : []
  return {
    ...Object.fromEntries(files.map(file => [`/${relative(publicFolder!, file)}`, Bun.file(file)])),
    '/*': frontend,
  }
}
