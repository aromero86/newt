import type { HTMLBundle, Server } from 'bun'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { serveFrontend } from './serve-frontend'
import type { ServeOptions } from './serve-options'
import { toErrorResponse } from './to-error-response'

/**
 * A server for a context: its router's routes, the ones beside them, its health if
 * asked, and its frontend or a 404. Whatever throws outside a route (a route beside
 * the router's) is the same 500 a route gives, never Bun's page with the source,
 * unless `development` asks for it.
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
  const server = Bun.serve({
    port: options.port,
    development,
    routes: { ...health, ...options.router.routes(), ...options.routes, ...sourceFrontend(options.frontend, options.publicFolder) },
    fetch: typeof options.frontend === 'string' ? serveFrontend(options.frontend) : () => new Response('Not found', { status: 404 }),
    // In development Bun's own page answers instead, with the source.
    ...(development ? {} : { error: toErrorResponse }),
  })
  const stop = server.stop.bind(server)
  server.stop = async (closeActiveConnections?: boolean) => {
    stopping = true
    if (options.drainMs) await Bun.sleep(options.drainMs)
    return stop(closeActiveConnections)
  }
  return server
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
