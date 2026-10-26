/**
 * How a client that only knows where auth is finds out the rest (RFC 8414): where to
 * send the person, get tokens, register and give tokens back. boards names auth in
 * its MCP server's own metadata (RFC 9728), and an MCP client follows it here.
 */
export function oauthServerMetadataRoutes(publicUrl: string): Bun.Serve.Routes<undefined, string> {
  const metadata = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    revocation_endpoint: `${publicUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // A product's web app proves itself with its secret; an MCP client is public, with PKCE.
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  }
  return {
    // Read by clients in a browser too, such as the MCP inspector.
    '/.well-known/oauth-authorization-server': () => Response.json(metadata, { headers: { 'access-control-allow-origin': '*' } }),
  }
}
