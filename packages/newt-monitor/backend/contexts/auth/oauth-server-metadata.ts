import type { HttpRouter } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../shared/cors/cors'

/**
 * How a client that only knows where the monitor is finds out the rest (RFC 8414):
 * where to send the person, get tokens, register and give tokens back. The MCP
 * server's own metadata (RFC 9728) names the monitor, and an MCP client follows it here.
 */
export function registerOauthServerMetadata(oauth: HttpRouter, publicUrl: string): void {
  const metadata = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    revocation_endpoint: `${publicUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // Every client registers itself, and is public: it proves itself with PKCE.
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  }
  oauth.get('/.well-known/oauth-authorization-server', () => Response.json(metadata), { cors: OPEN_TO_BROWSERS })
}
