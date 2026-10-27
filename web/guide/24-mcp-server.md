# An MCP server

Ana keeps her team's work in cooper. She also talks to an AI assistant, such as
Claude, all day. She would like to say "put a card in Launch for the press kit and
give it to Bob" and have it done, in her name, by the same rules as when she clicks.

The assistant speaks **MCP**, the Model Context Protocol: it calls *tools* a server
offers, over HTTP. This chapter gives boards an MCP server at `/mcp`. Three questions
shape it:

- **Who is calling?** Not a browser with a cookie. The assistant brings an access
  token that auth gave it through OAuth, for this server ([chapter
  21](./21-oauth-server)). boards asks auth whose token it is, on every request.
- **How does an assistant that only knows `/mcp` learn where to sign in?** The 401 it
  gets without a token names a small JSON document, the *protected resource
  metadata*, which names auth.
- **What may it do?** Exactly what its person may, and nothing more. Each tool calls
  the same use cases as boards' routes, in a workspace the person is checked to belong
  to. The actor says the change came `via: 'mcp'`, so a card's activity tells Ana's
  clicks from her assistant's.

The protocol itself is `@modelcontextprotocol/sdk`'s. What newt gives is the rest: a
second router at the root, an authenticator for bearer tokens, and a route's own
`onError`.

## The SDK

Add the MCP SDK, at the version cooper uses:

```sh
bun add --exact @modelcontextprotocol/sdk@1.30.1
```

It speaks the protocol both ways: `McpServer` and a transport for boards, and a
`Client` the end-to-end test uses as an assistant would.

## The protected resource metadata

An MCP client starts knowing one address, `http://localhost:3002/mcp`. It finds the
rest in three steps:

1. It calls `/mcp` with no token. The answer is a **401** whose `WWW-Authenticate`
   header names the **protected resource metadata** (RFC 9728).
2. That metadata names auth as the **authorization server**.
3. auth's own metadata (RFC 8414, chapter 21's `/.well-known/oauth-authorization-server`)
   says where to register, send the person and get tokens.

Step 2 is a plain JSON document. Create a folder `mcp` in boards for the MCP server,
and in it:

```ts
// cooper/backend/contexts/boards/mcp/protected-resource.ts
import type { HttpRouter } from 'newt/http'

/**
 * How an MCP client that only knows the MCP server's address finds out how to sign in
 * (MCP authorization): the protected resource metadata (RFC 9728) names auth as its
 * authorization server, and auth's own metadata (RFC 8414) says the rest.
 */
export function registerProtectedResource(router: HttpRouter, resource: string, authPublicUrl: string): void {
  const metadata = {
    resource,
    authorization_servers: [authPublicUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Cooper',
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
```

`resource` is the address the tokens are for: boards' public URL plus `/mcp`. auth
knows the same address already, as the `mcpResource` of the product `cooper` (chapter
21), and writes it into every token it gives an MCP client that asked for it. The
routes are `public`: whoever wants to sign in has no token yet.

`resourceMetadataUrl` is where the 401 sends a client. It is a function of its own
because the 401 and the routes must agree on it.

## The MCP server

Now the server itself. The file is short, but each part is a piece of newt you meet
here for the first time, or meet in a new place:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { bearerAuthenticator, HttpRouter, NotSignedIn, toErrorResponse } from 'newt/http'
import { OPEN_TO_BROWSERS } from '../../../shared/cors'
import type { Boards_Auth, Boards_Modules } from '../initialize-modules'
import { registerMcpTools } from './mcp-tools'
import { registerProtectedResource, resourceMetadataUrl } from './protected-resource'

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
 * never in a cookie.
 */
export function mcpRoutes(modules: Boards_Modules, auth: Pick<Boards_Auth, 'token'>, options: McpOptions): Bun.Serve.Routes<undefined, string> {
  const resource = `${options.publicUrl}/mcp`
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS })
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
```

Take it from the top.

### A second router at the root

boards' API is `base.http`, a router under `/api` whose authenticator reads the web
session's cookie (chapter 22). The MCP server is not under `/api`, and it does not
use the cookie. So it gets a router of its own:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  const router = new HttpRouter({ prefix: '', cors: OPEN_TO_BROWSERS })
// …
```

You met this in chapter 21, where auth serves its OAuth endpoints from one. `prefix:
''` mounts the router at the root, beside the frontend: it takes only the paths it
registers (`/mcp` and the two `/.well-known/…`), and any other address is still the
frontend's. Options given to the router are every route's default, so `cors:
OPEN_TO_BROWSERS` (chapter 21's `shared/cors.ts`) opens all three to pages of any
origin. Some MCP clients run in a browser: the MCP inspector finds out how to sign
in, and calls `/mcp`, from a page of its own origin. That is safe here for the same
reason as for auth's endpoints: nothing on this router reads a cookie, so a page of
another origin has nothing of the person's to borrow. Who calls is in the bearer
token.

`router.routes()` at the end is the table Bun is given, as for every router. A
method a path does not have is a 405: the server answers only `POST /mcp`, so `GET
/mcp` (which would open a stream of messages the server sends unasked) and `DELETE
/mcp` (which would end a session) are refused, and an `OPTIONS` from another origin
gets its preflight.

### `bearerAuthenticator`

Unlike auth's OAuth router, this one is not public: every route on it needs someone
signed in, unless it says `public` (the metadata does). Who is signed in is what its
authenticator says, and it is set as on any router, with `authenticateWith`:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  // A token of auth's for this server only: not one for another server, nor a web app's.
  router.authenticateWith(bearerAuthenticator(async accessToken => {
    const identity = await auth.token.verify(accessToken)
    return identity?.resource === resource ? { userId: identity.userId, via: 'mcp' } : null
  }))
// …
```

`bearerAuthenticator` from `newt/http` reads the token from
`Authorization: Bearer <token>` (RFC 6750). A request without one is nobody's, and your `verify` is not
called. With one, `verify` gets the token and answers the actor, or `null` for a
token that is not valid. That is all it does: what a token means is yours to say.

Here auth says it. `auth.token.verify` is chapter 21's use case, called in the same
process: who the token is for, for which client and which resource, or `null` if it
opens nothing (unknown, expired, revoked). boards accepts it only if its `resource` is
this server. A token auth gave boards' own web app has no resource, and one for some
other MCP server has another: both are refused, though auth would vouch for them.

The actor it answers is `{ userId, via: 'mcp' }`. The router runs the route as that
actor (`runAsActor`), so every use case a tool calls sees Ana in `currentActor()`,
exactly as after the web session's authenticator, which says `via: 'web'`. Chapter 4
made `via` required on cooper's actor, with `'mcp'` among its values; this is the door
that gives it.

`auth` here is `Pick<Boards_Auth, 'token'>`: of auth's use cases boards is handed
(chapter 20), the MCP server needs one.

### One server per request

The route builds a fresh `McpServer` for every POST, with the tools, and a transport
that answers this one request:

- `sessionIdGenerator: undefined` keeps no session. Nothing is remembered between
  requests: the token says who calls, every time.
- `enableJsonResponse: true` answers with plain JSON, not a stream. Nothing here sends
  the client anything it did not ask for, so no stream needs to stay open.

`transport.handleRequest` takes the web-standard `Request` and gives back a
`Response`, which is what a newt route returns. The `finally` closes the server either
way. It is a little work per request, and it buys a route like any other: no state, so
any number of processes can serve it.

`INSTRUCTIONS` is what the assistant reads about the server when it connects: what
cooper is, and where to start.

### A 401 that says where to sign in: `onError`

Without a token, or with a forged one, the router throws `NotSignedIn` before the
route runs. On boards' API, `toErrorResponse` makes it the usual 401 with `{ error,
code: 'not_signed_in' }`. That is not enough for an MCP client: MCP's authorization
says a 401 must carry a `WWW-Authenticate` header that names the protected resource
metadata, or the client cannot find auth.

A route can say what its errors become, with its own `onError`:

```ts
// cooper/backend/contexts/boards/mcp/mcp.ts
// …
  }, {
    // Without a token, or with one that is not valid: where to get one.
    onError: (error, request) => error instanceof NotSignedIn
      ? Response.json(
        { error: 'An access token for this MCP server is needed: connect through OAuth' },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(options.publicUrl)}"${request.headers.has('authorization') ? ', error="invalid_token"' : ''}` } },
      )
      : toErrorResponse(error),
  })
// …
```

`onError` is a `RouteOptions` field, like `public` and `cors`. It gets whatever the
route threw, and the request; it answers the `Response`. A missing session's
`NotSignedIn` goes through it too, since the check runs inside the route's handling.
Chapter 21's OAuth routes use it to answer in OAuth's format
(`toOauthErrorResponse`); here it answers one error its own way and hands every other
to `toErrorResponse`, so the rest stays as on the API.

The header follows RFC 6750: `Bearer resource_metadata="…"` when no token came, and
`error="invalid_token"` added when one came and was refused, so the client knows to
get a new one rather than to sign in for the first time. Note what the 401 does not
say: why a token was refused. Expired, revoked, for another server: all the same to
the caller.

Errors from the tools do not come here. The SDK catches what a tool throws and
answers the tool call with `isError` and the error's message, which the assistant
reads. A route's errors are the transport's; a tool's are the protocol's.

## The tools

A tool is the MCP twin of a route: it reads its arguments and calls use cases. It
decides nothing itself. cooper has eight. You type two of them here, `list_workspaces`
and `create_card`, which show everything the others do. Copy the file as it is at
this chapter's tag:

```sh
git checkout tutorial/24 -- cooper/backend/contexts/boards/mcp/mcp-tools.ts
```

Then read along. The top of the file holds what every tool shares:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mapPage, type Page, type PageRequest } from 'newt/core'
import { z } from 'zod'
import type { Boards_Modules } from '../initialize-modules'
import type { CardDTO, CardFilterDTO } from '../modules/card/card.schema'
import type { WorkspaceMemberDTO } from '../modules/workspace/workspace.schema'
import { inWorkspace } from '../workspace-scope'

/** Tools that only read. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
/** Tools that create or change, never delete. */
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

const workspaceId = z.string().describe('The workspace\'s id, from list_workspaces')
const pageArgs = {
  cursor: z.string().optional().describe('The nextCursor of the page before, to read the next one'),
  size: z.number().int().min(1).max(100).optional().describe('How many items, 20 by default'),
}

const pageOf = (args: { cursor?: string, size?: number }): PageRequest => ({ size: args.size ?? 20, cursor: args.cursor })

/** A page as a tool answers it: with the cursor of the next one, if there is one. */
function paged<T, R>(page: Page<T>, map: (item: T) => R) {
  const { items, total, nextCursor } = mapPage(page, map)
  return { items, total, nextCursor: nextCursor ?? null }
}

/** What a tool returns: its answer as JSON, for the assistant to read. */
const answer = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/** A card as the assistant reads it: its assignee by name too. */
function cardOf(card: CardDTO, members: WorkspaceMemberDTO[]) {
  const assignee = members.find(member => member.id === card.assigneeId)
  return {
    id: card.id,
    number: card.number,
    title: card.title,
    description: card.description,
    boardId: card.boardId,
    columnId: card.columnId,
    position: card.position,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  }
}
// …
```

- The **annotations** tell the assistant, and the person approving its calls,
  whether a tool only reads (`readOnlyHint`), may destroy something
  (`destructiveHint`), or reaches outside cooper (`openWorldHint`). None of boards'
  tools deletes.
- The **arguments** are zod schemas, with a `describe` the assistant reads: say where
  each id comes from (`from list_workspaces`). The SDK validates them before the tool
  runs.
- **`answer`** is what a tool gives back: text, here JSON. `cardOf` shapes a card for
  the assistant, with its assignee's name as well as the id, so it does not have to
  look Bob up to tell Ana who has the card. `paged` turns a newt `Page` into items,
  a total and the next cursor (`mapPage`, chapter 3).

Then the function that registers the tools on a server:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
// …
/**
 * boards' tools, for the person whose token the assistant brings. Like the routes,
 * they only call use cases: a tool given a workspace runs in it once the person is
 * checked to belong to it (`inWorkspace`), as a route under `/workspaces/:workspaceId`.
 */
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
```

`list_workspaces` takes no argument and calls `workspace.mine`, the use case behind
`GET /api/workspaces` (chapter 20). It is the assistant's first call: every other
tool needs a workspace id, and this is where it gets one. It runs in no workspace,
as its route does.

`create_card` does run in one:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
// …
  server.registerTool('create_card', {
    title: 'Create a card',
    description: 'Adds a card at the bottom of a column of a board, assigned to a member of the workspace if given (list_members says who they are).',
    inputSchema: {
      workspaceId,
      boardId: z.string(),
      columnId: z.string().describe('A column of the board, from get_board'),
      title: z.string().describe('Up to 200 characters'),
      description: z.string().optional(),
      assigneeId: z.string().optional().describe('A member\'s id, from list_members'),
    },
    annotations: WRITE,
  }, async ({ workspaceId: id, boardId, ...input }) => within(id, async () =>
    answer(cardOf(await card.create(boardId, input), await workspace.members()))))
// …
```

### `inWorkspace`: the same check as the route group

A route under `/api/workspaces/:workspaceId` is in chapter 4's group: its middleware
checks the person belongs to the workspace (`member.enter`) and runs the route in its
scope. A tool has no path. It gets the workspace id as an argument, so it enters the
scope itself, with `inWorkspace`, which you wrote in chapter 4 for this moment:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
// …
/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

It is **the same check** as the group's. A workspace Ana is not in does not exist to
her assistant either: `member.enter` throws `WorkspaceNotFound`, and the assistant
reads its message. Inside, every repository of boards sees only that workspace's rows.
`within` in `registerMcpTools` is only `inWorkspace` with boards' `member` module
filled in.

Then `card.create(boardId, input)` is the very use case `POST
/api/workspaces/:workspaceId/boards/:boardId/cards` calls. Everything you built for it
holds, without a line here:

- the title has up to 200 characters, the column is one of the board's, and a board
  holds at most 500 cards (chapter 7);
- the card gets the next number of its board, however many are created at once
  (chapter 7);
- an assignee must be a member of the workspace (chapter 7), and gets an email from
  a worker (chapter 12);
- the card is indexed for search, and its activity is written (chapters 11 and 16).

The activity is where `via` shows. A card's events carry who changed it (`by`) and how
(`via`), from `currentActor()` (chapter 10), and the activity keeps both. A card Ana's
assistant creates reads "Ana, through MCP", not just "Ana". `via` says how someone
came in, never what they may do: no use case allows or refuses anything by it.

### The other six

The rest of the file follows the same two shapes. Each is a thin call to use cases
you already have:

| Tool | Use cases it calls |
|---|---|
| `list_workspaces` | `workspace.mine` |
| `list_boards` | `board.list` |
| `get_board` | `workspace.boardView`, `workspace.members` |
| `list_members` | `workspace.members` |
| `search_cards` | `card.search`, `workspace.members` |
| `create_card` | `card.create`, `workspace.members` |
| `move_card` | `card.move`, `workspace.members` |
| `assign_card` | `card.assign` or `card.unassign`, `workspace.members` |

Shape them around the questions an assistant will ask, not around your routes.
`list_members` exists because an assistant told "give this to Bob" needs Bob's id,
and should not read a whole board to find him. `search_cards` takes plain arguments
(`text`, `boardId`, `assigneeId`) and builds the `CardFilter` itself: an assistant
writes those more reliably than a filter tree.

## Serving it from boards

A context serves more than its API by overriding `routes()` (chapter 21's
`ServedContext`). Its MCP server needs auth's `token` use case, which boards is handed
when it opens: keep it on the context. In `boards.context.ts`, import `Boards_Auth`
and `mcpRoutes`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
import { initializeModules, type Boards_Auth, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'
import { mcpRoutes } from './mcp/mcp'
// …
```

Say it in the context's description, take `auth` in the constructor, and pass
`deps.auth` from `open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
/**
 * The SaaS: each workspace's boards, their columns and cards, on the web and through
 * MCP. Its people sign in through `auth`, which also keeps the workspaces and who
 * belongs to each: `boards` is handed auth's modules when it opens, and
 * calls their use cases as its own.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config, private readonly auth: Boards_Auth) {
    super('boards', base, config)
  }
// …
    return new Boards_Context(base, modules, config, deps.auth)
  }
// …
```

And add the override after `open`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
// …
  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
```

`publicUrl` and `authPublicUrl` are boards' settings already (chapters 21 and 22). Update the
description of boards' settings in `config.ts` to match:

```ts
// cooper/backend/config.ts
// …
  /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
  boards: {
// …
```

## The public URL in development

In development people open boards at `http://localhost:3002`, its public URL, where
boards serves its pages, its API, and now `/mcp` and the metadata, with nothing in
front (chapter 23). The resource the tokens are for is that public URL plus `/mcp`.
In production it is boards' own domain, and the same paths go to the same server.

The seed tells you where it is. In `cooper/scripts/seed.ts`, add a line to what it
prints, after Bob's:

```ts
// cooper/scripts/seed.ts
// …
    '  bob@cooper.dev     a member of Acme, who accepted Ana\'s invitation',
    '',
    `  MCP server         ${config.boards.publicUrl}/mcp (OAuth: sign in as Ana or Bob)`,
    '',
  ].join('\n'))
// …
```

And in `open-test-boards.ts`, `as` now stands for a tool too. Only its comment
changes:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
// …
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
// …
```

## The test

cooper's end-to-end test gets a `describe('the MCP server')` that connects an MCP
client the way Claude would. Most of it is the OAuth dance, protocol code like chapter
21's: copy the file.

```sh
git checkout tutorial/24 -- cooper/backend/cooper.test.ts
```

Its first test starts knowing only `/mcp`, and follows the 401:

```ts
// cooper/backend/cooper.test.ts
// …
    // It only knows the MCP server's address: the 401 says where to find the rest.
    const refused = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(refused.status).toBe(401)
    const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
    const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
    expect(resource).toEqual(expect.objectContaining({ resource: boardsUrl('/mcp'), authorization_servers: [contexts.auth.config.publicUrl] }))
// …
```

Then it registers a client at auth, signs Ana in with PKCE asking for this resource,
trades the code for a token, and connects the SDK's `Client` with it. It calls every
tool, and checks what the activity says:

```ts
// cooper/backend/cooper.test.ts
// …
      // Its activity says the assistant did it, as Ana.
      await settled()
      const activity = await runAsActor({ userId: ana.id, via: 'web' }, () => inWorkspace(contexts.boards.modules.member, acme.id, () => contexts.boards.modules.activity.listForCard(card.id, { size: 10 })))
      expect(activity.items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
        ['unassigned', ana.id, 'mcp'],
        ['assigned', ana.id, 'mcp'],
        ['moved', ana.id, 'mcp'],
        ['created', ana.id, 'mcp'],
      ])

      // As on the web: a workspace the person is not in does not exist to them.
      const result = (await client.callTool({ name: 'list_boards', arguments: { workspaceId: '01900000-0000-7000-8000-000000000000' } })) as { isError?: boolean, content: { text: string }[] }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('no workspace')
// …
```

The second test is the door: no token, a forged one, and a preflight from another
origin.

## Check it

The gate, as at the end of every chapter:

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

The MCP tests alone:

```sh
bun test cooper/backend/cooper.test.ts -t MCP
```

```text
 2 pass
 4 filtered out
 0 fail
 30 expect() calls
Ran 2 tests across 1 file.
```

While they run, boards' activity log prints the card the assistant moved, with how it
came in at the end of the line:

```text
[boards] #2 "Ship the MCP server" moved from column 01a17967-… to 01a17967-… by 01a17967-… (mcp)
```

Now by hand. Start the backend:

```sh
bun cooper/backend/index.ts
```

and, in another terminal, call `/mcp` without a token:

```sh
curl -i -X POST http://localhost:3002/mcp
```

```text
HTTP/1.1 401 Unauthorized
Content-Type: application/json;charset=utf-8
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: mcp-session-id, www-authenticate
www-authenticate: Bearer resource_metadata="http://localhost:3002/.well-known/oauth-protected-resource/mcp"

{"error":"An access token for this MCP server is needed: connect through OAuth"}
```

The header names the metadata at boards' **public** URL, built from the setting, not
from the address you called: that is the address clients use. Here they are the same.
Ask for it:

```sh
curl http://localhost:3002/.well-known/oauth-protected-resource/mcp
```

```json
{"resource":"http://localhost:3002/mcp","authorization_servers":["http://localhost:3001"],"bearer_methods_supported":["header"],"resource_name":"Cooper"}
```

auth, at `http://localhost:3001`, is where to sign in. With a token that is not
one, the 401 says so:

```sh
curl -i -X POST http://localhost:3002/mcp -H 'authorization: Bearer not-a-token'
```

```text
HTTP/1.1 401 Unauthorized
…
www-authenticate: Bearer resource_metadata="http://localhost:3002/.well-known/oauth-protected-resource/mcp", error="invalid_token"
```

And a GET, which would open a stream the server never keeps, is refused before anyone
is asked for a token:

```sh
curl -i http://localhost:3002/mcp
```

```text
HTTP/1.1 405 Method Not Allowed
…
allow: POST

{"error":"GET is not allowed on /mcp","code":"method_not_allowed"}
```

### Connect a real client

Seed cooper and start it with its frontends (chapter 23):

```sh
bun run cooper:seed
bun run cooper
```

Use boards' public URL, `http://localhost:3002/mcp`: the tokens are for that address.

**Claude Code.** Add the server, then authenticate from inside Claude Code with
`/mcp`. Your browser opens auth's sign-in page. Sign in as `ana@cooper.dev` with the
seed's password, and allow access:

```sh
claude mcp add --transport http cooper http://localhost:3002/mcp
```

**The MCP inspector.** Run it, choose the Streamable HTTP transport, enter
`http://localhost:3002/mcp`, and connect. It goes through the same OAuth flow from its
page, on another origin, which is why the routes are open to any:

```sh
bunx @modelcontextprotocol/inspector
```

Ask for Ana's workspaces, or create a card, and watch it appear in boards' UI.

## What to remember

- An MCP server is **another door**, like the routes: its tools call the same use
  cases, as the token's person, in a workspace entered with `inWorkspace`, the same
  check as the route group. It adds no rules of its own.
- Addresses outside `/api` get **a second router at the root** (`prefix: ''`),
  served through the context's `routes()` override. Its options are every route's
  default, `cors` included.
- **`bearerAuthenticator`** reads the token; what it means is yours to say. Verify it
  in-process with auth's `token.verify`, and accept it only for this resource.
- A route's own **`onError`** decides what its errors become, a missing session's
  `NotSignedIn` too: here a 401 whose `WWW-Authenticate` names the protected resource
  metadata, which names auth.
- `via: 'mcp'` says **how** someone came in, never what they may do. It goes into the
  record (events, activity), not into the rules.

Next: [A third context that reads two](./25-backoffice).
