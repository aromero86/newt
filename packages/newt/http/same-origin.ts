import type { Cors } from './cors'
import { CrossOriginRefused } from './errors/cross-origin-refused'
import type { HttpRoute } from './http-route'

/**
 * A route that writes and refuses what a page of another origin sends it, unless its
 * `cors` lets that origin call: a form or a script of another site cannot act for
 * whoever is signed in, whatever their cookies. The browser says where a request comes
 * from (`Sec-Fetch-Site`, or, from an older one, `Origin`); a request that says neither
 * comes from no page (a server, a script, a webhook) and goes through.
 */
export function sameOrigin(route: HttpRoute, cors: Cors | undefined): HttpRoute {
  return request => {
    if (!fromOwnOrigin(request, cors)) throw new CrossOriginRefused()
    return route(request)
  }
}

function fromOwnOrigin(request: Request, cors: Cors | undefined): boolean {
  const origin = request.headers.get('origin')
  const allowed = cors && origin && (cors.origin === '*' || cors.origin.includes(origin))
  const site = request.headers.get('sec-fetch-site')
  // `none`: the person did it themselves (typed the address, a bookmark).
  if (site) return site === 'same-origin' || site === 'none' || Boolean(allowed)
  if (!origin) return true
  if (allowed) return true
  try {
    return new URL(origin).host === request.headers.get('host')
  } catch {
    // `null`, from a sandboxed frame or a redirect across sites: no origin it could be.
    return false
  }
}
