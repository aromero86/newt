import { createHmac } from 'node:crypto'

/** The headers a signed request carries: when it was made, what makes it unique, and its signature. Never the key. */
export const MONITOR_HEADERS = {
  timestamp: 'x-newt-timestamp',
  nonce: 'x-newt-nonce',
  signature: 'x-newt-signature',
} as const

/** The shortest key a monitor and an application may share. */
export const MIN_KEY_LENGTH = 32

/**
 * The signature of one request: HMAC-SHA256, with the key both sides share, of what
 * makes the request this one (its method, its path and query, when it was made, and a
 * nonce of its own), hex. The prefix names the scheme, so another may come later.
 */
export function monitorSignature(key: string, request: { method: string, path: string, timestamp: string, nonce: string }): string {
  const signed = ['newt-monitor-v1', request.method.toUpperCase(), request.path, request.timestamp, request.nonce].join('\n')
  return createHmac('sha256', key).update(signed).digest('hex')
}
