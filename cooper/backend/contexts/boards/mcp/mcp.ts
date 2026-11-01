import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { bearerAuthenticator, HttpRouter, NotSignedIn, toErrorResponse } from 'newt-kit/http'
import type { RateLimitStore } from 'newt-kit/port-rate-limit'
import { OPEN_TO_BROWSERS } from '../../../shared/cors'
import { MCP_LIMIT } from '../../../shared/rate-limits'
import type { Boards_Auth, Boards_Modules } from '../initialize-modules'
import { registerMcpTools } from './mcp-tools'
import { registerProtectedResource, resourceMetadataUrl } from './protected-resource'

export type McpOptions = {
  /** Where people open boards: the MCP server is at its `/mcp`, the resource its tokens are for. */
  publicUrl: string
  /** auth, the authorization server the MCP clients sign in with. */
  authPublicUrl: string
  /** Where its rate limit counts: the context's. */
  rateLimits: RateLimitStore
}

const INSTRUCTIONS = [
  'Cooper keeps boards of cards, like Trello, in workspaces.',
  'Start with list_workspaces: every other tool takes a workspace id. A board has columns (its cards\' statuses) and cards;',
  'get_board shows them all, and the members a card can be assigned to.',
].join(' ')

/**
 * boards' MCP server, at `/mcp` (Streamable HTTP), and the metadata that says how to
 * sign in to it, for AI assistants (Claude, the MCP inspector…): a router at the root
 * of its own. It acts for the person whose access token the assistant brings: one
 * auth gave for this server through OAuth (`auth.token.verify`, with this server as
 * its resource). Like the routes, the tools only call use cases.
 *
 * It keeps no session: each request is a server of its own, answered in JSON. Nothing
 * here sends a client anything it did not ask for, so there is no stream to keep open:
 * GET, which would open one, and DELETE, which would end a session, are a 405.
 *
 * Open to pages of any origin, such as the MCP inspector's: who calls is in the token,
 * never in a cookie. Each person may ask it `MCP_LIMIT`.
 */
export function mcpRoutes(modules: Boards_Modules, auth: Pick<Boards_Auth, 'token'>, options: McpOptions): Bun.Serve.Routes<undefined, string> {
  const resource = `${options.publicUrl}/mcp`
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS, rateLimits: options.rateLimits, rateLimit: MCP_LIMIT })
  // A token of auth's for this server only: not one for another server, nor a web app's.
  router.authenticateWith(bearerAuthenticator(async accessToken => {
    const identity = await auth.token.verify(accessToken)
    return identity?.resource === resource ? { userId: identity.userId, via: 'mcp' } : null
  }))

  router.post('/mcp', async request => {
    const server = new McpServer({ name: 'cooper', version: '1.0.0' }, { instructions: INSTRUCTIONS })
    registerMcpTools(server, modules)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(request)
    } finally {
      await server.close()
    }
  }, {
    // Without a token, or with one that is not valid: where to get one.
    onError: (error, request) => error instanceof NotSignedIn
      ? Response.json(
        { error: 'An access token for this MCP server is needed: connect through OAuth' },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${request.headers.has('authorization') ? ', error="invalid_token"' : ''}` } },
      )
      : toErrorResponse(error),
  })

  registerProtectedResource(router, resource, options.authPublicUrl)
  return router.routes()
}
