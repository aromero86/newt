import type { Server } from 'bun'

/** The address each request came from, as `serve` saw it. */
const addresses = new WeakMap<Request, string>()

/**
 * The address a request came from: the socket's, or, behind `trustProxy` proxies, the
 * one the first of them saw, from the end of `X-Forwarded-For` (each proxy adds the
 * address it was called from). A client may write the header itself: only the proxies'
 * entries are trusted. `null` for a request `serve` did not take.
 */
export function clientIp(request: Request): string | null {
  return addresses.get(request) ?? null
}

/** Notes the address a request came from, as `serve` takes it. */
export function noteClientIp(request: Request, server: Server<undefined>, trustProxy: number): void {
  const socket = server.requestIP(request)?.address ?? null
  const forwarded = trustProxy > 0 ? request.headers.get('x-forwarded-for')?.split(',').map(entry => entry.trim()).filter(Boolean) ?? [] : []
  const address = forwarded.length > 0 ? forwarded[Math.max(0, forwarded.length - trustProxy)]! : socket
  if (address) addresses.set(request, address)
}
