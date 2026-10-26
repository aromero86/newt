# An MCP server

An AI assistant, such as Claude, can work with cooper's boards: list them, read a
board, create, move and assign cards. It does so through an **MCP server** that
boards serves at `/mcp`. The assistant acts **for a person**, with an access token
auth gave it through OAuth ([chapter 20](./20-oauth-server)).

The MCP server adds no logic. Its tools call the same use cases as boards' routes,
as the token's person, in the same workspace scope. Everything you built so far
applies: the rules, the 404 for a workspace you are not in, the emails from workers.

## Where it is served

boards serves `/mcp` and its metadata beside its API. A context adds routes outside
`/api` by overriding `routes()`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
/** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
protected override routes(): Bun.Serve.Routes<undefined, string> {
  return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
}
```

## How a client finds out how to sign in

An MCP client starts knowing only the server's address. It finds the rest in three
steps:

1. It calls `/mcp` with no token. The answer is a **401** whose `WWW-Authenticate`
   header points at the **protected resource metadata** (RFC 9728).
2. That metadata names auth as the **authorization server**.
3. auth's own metadata (RFC 8414) says where to register, authorize and get tokens.

The metadata is a plain JSON document:

```ts
// cooper/backend/contexts/boards/mcp/protected-resource.ts
export function protectedResourceRoutes(resource: string, authPublicUrl: string): Bun.Serve.Routes<undefined, string> {
  const metadata = {
    resource,
    authorization_servers: [authPublicUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Cooper',
  }
  const answer = () => Response.json(metadata)
  return {
    // At the root and at the path of the resource: clients look in either (RFC 9728 §3.1).
    '/.well-known/oauth-protected-resource': answer,
    '/.well-known/oauth-protected-resource/mcp': answer,
  }
}

/** Where a 401 of the MCP server sends a client to find out how to sign in. */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/mcp`
}
```

The client then registers itself at auth, sends the person to auth to sign in and
consent, and trades the code for tokens. It asks for tokens for this **resource**,
`<boards' public URL>/mcp`: the `mcpResource` of the product `cooper`.

## The bearer token, verified in-process

Every request to `/mcp` brings an access token. boards asks auth who it is for,
with `token.verify`, a plain in-process call. It accepts the token only if it was
given **for this server**: not one for another resource, nor a web app's token.

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
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
```

Three things to see:

- **`runAsActor`.** Once the token is verified, the whole request runs as its
  person. Every use case a tool calls sees them in `currentActor()`, exactly as a
  route does after the web session's authenticator.
- **No session.** Each request gets a server of its own (`sessionIdGenerator:
  undefined`), answered in JSON (`enableJsonResponse: true`). Nothing is sent to the
  client unasked, so no stream stays open. It scales like any other route.
- **The SDK does MCP, newt does the rest.** `@modelcontextprotocol/sdk` speaks the
  protocol. Who the person is, and what they may do, stays in auth and boards.

## Tools call the same use cases

A tool is the MCP twin of a route. It checks nothing by itself, and only calls use
cases:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
export function registerMcpTools(server: McpServer, modules: Boards_Modules): void {
  const { workspace, board, card, member } = modules
  const within = <T>(id: string, fn: () => Promise<T>) => inWorkspace(member, id, fn)

  server.registerTool('list_workspaces', {
    title: 'List workspaces',
    description: 'The workspaces the person belongs to. Every other tool takes the id of one of them.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => answer((await workspace.mine()).map(({ id, name, isAdmin }) => ({ id, name, isAdmin }))))

  // …

  server.registerTool('move_card', {
    title: 'Move a card',
    description: 'Moves a card to a column of its board (its status), at a position from 0 at the top; at the bottom when none is given.',
    inputSchema: { workspaceId, cardId: z.string(), columnId: z.string(), position: z.number().int().min(0).optional() },
    annotations: WRITE,
  }, async ({ workspaceId: id, cardId, ...to }) => within(id, async () =>
    answer(cardOf(await card.move(cardId, to), await workspace.members()))))

  // …
}
```

A route under `/api/workspaces/:workspaceId` enters the workspace scope in its
group's middleware. A tool gets the workspace id as an argument, so it enters the
scope with `inWorkspace`, which makes **the same check**:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

So a tool can't reach a workspace the person isn't in, and every repository below
sees only that workspace's rows ([chapter 5](./05-who-and-where)).

The tools are:

| Tool | Use cases it calls |
|---|---|
| `list_workspaces` | `workspace.mine` |
| `list_boards` | `board.list` |
| `get_board` | `workspace.boardView`, `workspace.members` |
| `search_cards` | `card.search`, `workspace.members` |
| `create_card` | `card.create` |
| `move_card` | `card.move` |
| `assign_card` | `card.assign` or `card.unassign` |

Because they are the same use cases, everything else follows for free. A card
assigned from Claude emails its assignee, from a worker. A move that collides with
someone dragging the same card in the browser is retried. An assignee who isn't a
member is refused. When a use case throws, the SDK answers the tool call with
`isError` and the error's message, which the assistant reads.

Write the tools' descriptions for the assistant: what the tool does, where its ids
come from (`'The workspace\'s id, from list_workspaces'`), and annotations that say
whether it only reads (`readOnlyHint`) or changes something.

## CORS

Some MCP clients run in a browser. The MCP inspector is one: it discovers, registers,
trades its code and calls `/mcp` from a web page on another origin. So `/mcp`, the
protected resource metadata, and auth's endpoints the client calls itself, are
open to any origin with `openToBrowsers`:

```ts
// cooper/backend/shared/cors.ts
/**
 * What a page of another origin may send and read: the MCP inspector, for one, runs
 * in a browser, and finds out how to sign in, registers, trades its code and calls
 * the MCP server from there. Never with cookies: who it is goes in its bearer token,
 * so any origin may ask.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
  'access-control-max-age': '86400',
}
```

`*` is safe here because none of these routes reads a cookie. Who calls is in the
bearer token, which a page of another origin can't steal from the person's browser.
boards' API, which runs on the session cookie, is not opened.

## How to check it

cooper's end-to-end test connects an MCP client the way Claude would. It knows only
`/mcp`, follows the 401 to the metadata, registers, signs Ana in through auth with
PKCE, and trades the code:

```ts
// cooper/backend/cooper.test.ts
// It only knows the MCP server's address: the 401 says where to find the rest.
const refused = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
expect(refused.status).toBe(401)
const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
// …
```

Then it uses the tools with the SDK's own client:

```ts
// cooper/backend/cooper.test.ts
const card = await use<{ id: string, number: number }>(client, 'create_card', { workspaceId: acme.id, boardId: boards.items[0]!.id, columnId: todo.id, title: 'Ship the MCP server' })
expect(card.number).toBe(2)
expect(await use(client, 'move_card', { workspaceId: acme.id, cardId: card.id, columnId: doing.id })).toMatchObject({ columnId: doing.id, position: 0 })
expect(await use(client, 'assign_card', { workspaceId: acme.id, cardId: card.id, assigneeId: bob.id })).toMatchObject({ assignee: { id: bob.id, name: 'Bob' } })

// As on the web: a workspace the person is not in does not exist to them.
const result = (await client.callTool({ name: 'list_boards', arguments: { workspaceId: '01900000-0000-7000-8000-000000000000' } })) as { isError?: boolean, content: { text: string }[] }
expect(result.isError).toBe(true)
```

```bash
bun test cooper/backend/cooper.test.ts
```

With cooper running, a request without a token says where to go:

```bash
curl -i -X POST http://localhost:5172/mcp
```

```http
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer resource_metadata="http://localhost:5172/.well-known/oauth-protected-resource/mcp"
```

## Connect a real client

Start cooper and seed it:

```bash
bun run cooper:seed
bun run cooper
```

Use boards' **public URL**, `http://localhost:5172/mcp` in development. Its UI's
server passes `/mcp` and `/.well-known` on to boards' port, and the tokens are for
that address: the resource is the public URL plus `/mcp`.

**Claude Code.** Add the server, then authenticate from inside Claude Code with
`/mcp`. Your browser opens auth's sign-in page. Sign in as `ana@cooper.dev` with
the password `cooper-demo`, and allow access:

```bash
claude mcp add --transport http cooper http://localhost:5172/mcp
```

**The MCP inspector.** Run it, choose the Streamable HTTP transport, enter
`http://localhost:5172/mcp`, and connect. It goes through the same OAuth flow from
its page:

```bash
bunx @modelcontextprotocol/inspector
```

Then ask for Ana's workspaces, or move a card, and watch it move in boards' UI.

## In short

- An MCP server is **another entry point**, like routes: tools call the same use
  cases, as the token's person, in the same workspace scope.
- **The protected resource metadata** names auth; a 401 with `WWW-Authenticate`
  points at it.
- **Verify the bearer token in-process** with auth's `token.verify`, and accept it
  only for this resource. Then run the request with `runAsActor`.
- A tool given a workspace enters it with **`inWorkspace`**: the same check as the
  route group.
- Routes that work on a bearer token, never a cookie, may be **open to any origin**.
