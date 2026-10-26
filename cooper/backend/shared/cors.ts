type Route = (request: Request) => Response | Promise<Response>
type Routes = Bun.Serve.Routes<undefined, string>

/**
 * What a page of another origin may send and read: the MCP inspector, for one, runs
 * in a browser, and finds out how to sign in, registers, trades its code and calls
 * the MCP server from there. Never with cookies: who it is goes in its bearer token,
 * so any origin may ask.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
  'access-control-max-age': '86400',
}

/** A route any origin may call from a browser: it answers the preflight, and says so in every answer. */
export function openToBrowsers(route: Route): Route {
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const response = await route(request)
    // A Response.redirect's headers cannot change: a copy's can.
    const open = new Response(response.body, response)
    for (const [name, value] of Object.entries(CORS)) open.headers.set(name, value)
    return open
  }
}

/**
 * Some routes of a table, open to any origin from a browser (`openToBrowsers`), each
 * of its methods: a router's table has one route per method, and its own OPTIONS,
 * which the preflight's answer replaces.
 */
export function openRoutesToBrowsers(routes: Routes, paths: string[]): Routes {
  const open: Routes = { ...routes }
  for (const path of paths) {
    const entry = routes[path]
    if (entry === undefined) throw new Error(`No route ${path} to open to browsers`)
    open[path] = typeof entry === 'function'
      ? openToBrowsers(entry as Route)
      : entry instanceof Response
        ? entry
        : Object.fromEntries(Object.entries(entry).map(([method, route]) => [method, openToBrowsers(route as Route)]))
  }
  return open
}
