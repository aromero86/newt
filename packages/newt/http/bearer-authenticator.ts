import type { Actor } from '../core'
import type { Authenticator } from './authenticator'

/**
 * Tells who sent a request by its bearer token (`Authorization: Bearer <token>`, RFC
 * 6750), not a cookie: what an MCP client or another server sends. `verify` says whose
 * the token is, or `null` for one that is not valid; a request without one is nobody's.
 */
export function bearerAuthenticator(verify: (token: string) => Promise<Actor | null>): Authenticator {
  return async request => {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
    return token ? verify(token) : null
  }
}
