import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { runAsActor } from '../core/context/run-as-actor'
import { McpLinks, type McpContext } from './mcp-context'
import { MCP_GUIDE } from './mcp-guide'
import { registerDefinitionTools } from './tools/definition.tools'
import { registerProposalTools } from './tools/proposal.tools'
import { registerReleaseTools } from './tools/release.tools'
import { registerSearchTools } from './tools/search.tools'

/** A conversation with one assistant: forgotten after this long without a word. */
const IDLE_MINUTES = 60

type McpSession = { userId: string, server: McpServer, transport: WebStandardStreamableHTTPServerTransport, seenAt: number }

/**
 * The MCP entry: how AI assistants (Claude, Codex, Gemini…) read the definition and
 * write proposals, for the person whose access token they bring. Like the HTTP
 * routes, the tools only call use cases: no business logic lives here.
 */
export function mcpEntry(modules: McpContext['modules'], publicUrl: string) {
  const context: McpContext = { modules, links: new McpLinks(publicUrl) }
  const sessions = new Map<string, McpSession>()

  const open = (userId: string): McpSession => {
    const server = new McpServer({ name: 'newt', version: '1.0.0' }, { instructions: MCP_GUIDE })
    registerDefinitionTools(server, context)
    registerProposalTools(server, context)
    registerReleaseTools(server, context)
    registerSearchTools(server, context)
    const session: McpSession = { userId, server, transport: null!, seenAt: Date.now() }
    session.transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: id => void sessions.set(id, session),
      onsessionclosed: id => void sessions.delete(id),
    })
    void server.connect(session.transport)
    return session
  }

  const forgetIdle = () => {
    for (const [id, session] of sessions) if (Date.now() - session.seenAt > IDLE_MINUTES * 60_000) {
      sessions.delete(id)
      void session.server.close()
    }
  }

  return async (request: Request): Promise<Response> => {
    const authorization = request.headers.get('authorization') ?? ''
    const actor = await modules.authToken.authenticate(authorization.replace(/^Bearer\s+/i, ''))
    if (!actor) return Response.json({ error: 'An access token is needed: make one in newt, under Account settings → AI assistants' }, { status: 401 })

    forgetIdle()
    const sessionId = request.headers.get('mcp-session-id')
    const session = sessionId ? sessions.get(sessionId) : open(actor.userId)
    // A session nobody knows, or someone else's, is over: the assistant starts another.
    if (!session || session.userId !== actor.userId) return Response.json({ error: 'Session not found' }, { status: 404 })
    session.seenAt = Date.now()

    const assistant = session.server.server.getClientVersion()?.name
    return runAsActor({ ...actor, ...(assistant ? { assistant } : {}) }, () => session.transport.handleRequest(request))
  }
}
