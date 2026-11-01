import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { bearerAuthenticator, HttpRouter, NotSignedIn, toErrorResponse } from '@newt-kit/newt/http'
import { OPEN_TO_BROWSERS } from '../../../shared/cors/cors'
import { mcpResourceOf, type Auth_Modules } from '../../auth/initialize-modules'
import type { Monitor_Modules } from '../initialize-modules'
import { registerMcpTools } from './mcp-tools'
import { registerProtectedResource, resourceMetadataUrl } from './protected-resource'

const INSTRUCTIONS = [
  'newt-monitor watches applications built with newt: what each is made of, version by version, and how it runs.',
  'Start with list_apps: every other tool takes an application\'s id. get_structure says what it is made of;',
  'use_case_totals, errors_totals, queues and system_and_instances say how it is doing; list_deployments what it deployed and when; list_traces and get_trace show single runs.',
  'Windows are 1h, 24h, 7d, 30d, 90d or 365d. Everything is read-only.',
].join(' ')

/**
 * The monitor's MCP server, at `/mcp` (Streamable HTTP), and the metadata that says
 * how to sign in to it, for AI assistants (Claude, the MCP inspector…): a router at
 * the root of its own. It acts for the person whose access token the assistant brings:
 * one auth gave for this server through OAuth (`auth.token.verify`, with this server
 * as its resource). Like the routes, the tools only call use cases.
 *
 * It keeps no session: each request is a server of its own, answered in JSON. Nothing
 * here sends a client anything it did not ask for, so there is no stream to keep open:
 * GET, which would open one, and DELETE, which would end a session, are a 405.
 *
 * Open to pages of any origin, such as the MCP inspector's: who calls is in the token,
 * never in a cookie.
 */
export function mcpRoutes(modules: Monitor_Modules, auth: Pick<Auth_Modules, 'token'>, publicUrl: string): Bun.Serve.Routes<undefined, string> {
  const resource = mcpResourceOf(publicUrl)
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS })
  // A token of auth's for this server only.
  router.authenticateWith(bearerAuthenticator(async accessToken => {
    const identity = await auth.token.verify(accessToken)
    return identity?.resource === resource ? { userId: identity.userId, via: 'mcp' } : null
  }))

  router.post('/mcp', async request => {
    const server = new McpServer({ name: 'newt-monitor', version: '1.0.0' }, { instructions: INSTRUCTIONS })
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
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(publicUrl)}"${request.headers.has('authorization') ? ', error="invalid_token"' : ''}` } },
      )
      : toErrorResponse(error),
  })

  registerProtectedResource(router, resource, publicUrl)
  return router.routes()
}
