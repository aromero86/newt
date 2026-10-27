import { MONITOR_HEADERS, monitorSignature } from './monitor-signature'

/**
 * The headers that sign a request to an application's monitor endpoint
 * (`serveMonitor`), for whoever monitors it: each request signed on its own, made
 * now, with a nonce never used before. The key does not travel; a request seen on
 * the way is no use again, nor for another.
 *
 * ```ts
 * const url = 'http://cooper:3010/v1/structure'
 * const response = await fetch(url, { headers: signMonitorRequest(key, { url }) })
 * ```
 */
export function signMonitorRequest(key: string, request: { url: string, method?: string, now?: Date }): Record<string, string> {
  const { pathname, search } = new URL(request.url)
  const timestamp = String((request.now ?? new Date()).getTime())
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')
  return {
    [MONITOR_HEADERS.timestamp]: timestamp,
    [MONITOR_HEADERS.nonce]: nonce,
    [MONITOR_HEADERS.signature]: monitorSignature(key, { method: request.method ?? 'GET', path: pathname + search, timestamp, nonce }),
  }
}
