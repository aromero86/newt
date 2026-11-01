import type { HttpRouter } from 'newt-kit/http'

/**
 * How an MCP client that only knows the MCP server's address finds out how to sign in
 * (MCP authorization): the protected resource metadata (RFC 9728) names the monitor
 * as its authorization server, and its own metadata (RFC 8414) says the rest.
 */
export function registerProtectedResource(router: HttpRouter, resource: string, publicUrl: string): void {
  const metadata = {
    resource,
    authorization_servers: [publicUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'newt-monitor',
  }
  const answer = () => Response.json(metadata)
  // At the root and at the path of the resource: clients look in either (RFC 9728 §3.1).
  router.get('/.well-known/oauth-protected-resource', answer, { public: true })
  router.get('/.well-known/oauth-protected-resource/mcp', answer, { public: true })
}

/** Where a 401 of the MCP server sends a client to find out how to sign in. */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/mcp`
}
