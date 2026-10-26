import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { runAsActor } from 'newt/core'
import { openToBrowsers } from '../../../shared/cors'
import type { Boards_Auth, Boards_Modules } from '../initialize-modules'
import { registerMcpTools } from './mcp-tools'
import { protectedResourceRoutes, resourceMetadataUrl } from './protected-resource'

export type McpOptions = {
  /** Where people open boards: the MCP server is at its `/mcp`, the resource its tokens are for. */
  publicUrl: string
  /** auth, the authorization server the MCP clients sign in with. */
  authPublicUrl: string
}

const INSTRUCTIONS = [
  'Cooper keeps boards of cards, like Trello, in workspaces.',
  'Start with list_workspaces: every other tool takes a workspace id. A board has columns (its cards\' statuses) and cards;',
  'get_board shows them all, and the members a card can be assigned to.',
].join(' ')

/**
 * boards' MCP server, at `/mcp` (Streamable HTTP), and the metadata that says how to
 * sign in to it, for AI assistants (Claude, the MCP inspector…). It acts for the
 * person whose access token the assistant brings: one auth gave for this server
 * through OAuth (`auth.token.verify`, with this server as its resource). Like the
 * routes, the tools only call use cases.
 *
 * It keeps no session: each request is a server of its own, answered in JSON. Nothing
 * here sends a client anything it did not ask for, so there is no stream to keep open.
 */
export function mcpRoutes(modules: Boards_Modules, auth: Pick<Boards_Auth, 'token'>, options: McpOptions): Bun.Serve.Routes<undefined, string> {
  const resource = `${options.publicUrl}/mcp`
  const unauthorized = (error?: string) => Response.json(
    { error: 'An access token for this MCP server is needed: connect through OAuth' },
    { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${error ? `, error="${error}"` : ''}` } },
  )

  const mcp = async (request: Request): Promise<Response> => {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!accessToken) return unauthorized()
    // A token of auth's for this server only: not one for another server, nor a web app's.
    const identity = await auth.token.verify(accessToken)
    if (!identity || identity.resource !== resource) return unauthorized('invalid_token')

    // GET would open a stream for what the server tells unasked, and DELETE end a session: neither is kept.
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })

    const server = new McpServer({ name: 'cooper', version: '1.0.0' }, { instructions: INSTRUCTIONS })
    registerMcpTools(server, modules)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await runAsActor({ userId: identity.userId }, () => transport.handleRequest(request))
    } finally {
      await server.close()
    }
  }

  // Open to pages of any origin, such as the MCP inspector's: who calls is in the token, never in a cookie.
  const open = Object.fromEntries(Object.entries(protectedResourceRoutes(resource, options.authPublicUrl)).map(([path, route]) => [path, openToBrowsers(route as (request: Request) => Response)]))
  return { ...open, '/mcp': openToBrowsers(mcp) }
}
