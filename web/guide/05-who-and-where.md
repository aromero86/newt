# Who and where

Until now the tests said who was acting with an `x-user` header. A real app has to
answer three questions on every request:

- **Who is it?** Authentication.
- **May they do this?** Authorization.
- **What are they working on?** Scopes: the actor, and whatever your app adds. In
  cooper, the workspace.

This chapter answers the three in `boards`, and shows where each answer lives.

## The actor

Every request with a session runs as its **actor**. Any use case, however deep, knows
who is acting with `currentActor()`. You never pass the user's id from hand to hand.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  // …
}
```

The workspace's creator is whoever is signed in. If `create` took a `createdBy`
parameter, anyone could make a workspace in someone else's name.

Outside HTTP (a script, an MCP tool) you set the actor yourself with `runAsActor`. The
seed does it to act as Ana:

```ts
// cooper/scripts/seed.ts
const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id }, fn)
```

The framework knows one thing about the actor: its `userId`. That is all cooper
needs. If your app needs more (the session it came through, whether it is an
assistant), you can extend the `Actor` type with `declare module 'newt/core'`, in a
file every program of the app loads. Extend it with **who** someone is, never with
**what they may do**: you will see why in a moment.

## Authentication: who is it

The router asks an **authenticator** who sends each request. It returns the actor,
or `null` when there is no session, and then the router answers 401 without calling
the route. You set it once per context, with `http.authenticateWith`.

In cooper, people sign in at `auth`, the OAuth server (chapter
[20](./20-oauth-server)). `boards` and `backoffice` are OAuth clients of it, and
their servers do the OAuth themselves: a *backend for frontend*. The browser never
holds a token, only the context's own session cookie. That reusable piece lives in
`cooper/backend/shared/web-session`, a module both contexts initialize:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
const session = WebSession_Module.initialize(base, {
  context: 'boards',
  clientId: WORKSPACES_PRODUCT,
  clientSecret: config.clientSecret,
  publicUrl: config.publicUrl,
  authUrl: config.authPublicUrl,
  days: config.sessionDays,
  identify: accessToken => deps.auth.token.verify(accessToken),
  // …
})
```

It registers four routes (`GET /api/session/sign-in`, `GET /api/session/callback`,
`GET /api/session`, `POST /api/session/sign-out`) and the authenticator:

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
// Every route of the context runs as whoever its session cookie says.
base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))
```

The authenticator does not read the database itself. It asks a **use case** of the
module that knows the sessions:

```ts
// cooper/backend/shared/web-session/web-session.module.ts
/** Who sent a request, from the session cookie's token. An expired session is closed. */
@UseCase()
async authenticate(token: string | undefined): Promise<Actor | null> {
  const session = await this.find(token)
  if (!session) return null
  if (session.isExpired()) {
    session.close()
    await this.repo.persist(session)
    return null
  }
  return { userId: session.userId }
}

// …
private async find(token: string | undefined): Promise<WebSession | undefined> {
  const parsed = SecretToken.schema.safeParse(token)
  return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
}
```

The session keeps **only the hash** of its token. The token goes to the cookie and
never comes back to the store:

```ts
// cooper/backend/shared/web-session/web-session.ts
static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
  const token = SecretToken.generate()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
  return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
}
```

`SecretToken` is a value object of the framework: 32 random bytes, and their `hash`.
Someone who walks away with a copy of the database cannot sign in as anybody: they
have hashes, not tokens.

The sign-in itself is plain OAuth with PKCE. `complete` trades auth's code for an
access token over HTTP, asks auth who it is for, gives the tokens back, and opens the
session:

```ts
// cooper/backend/shared/web-session/web-session.module.ts
@UseCase({ retryOnConflict: false })
async complete(input: { code?: string, state?: string, error?: string, errorDescription?: string, pending?: string }): Promise<{ token: SecretToken, returnTo: string }> {
  // …
  const tokens = await this.post('/oauth/token', { grant_type: 'authorization_code', code: input.code, redirect_uri: this.redirectUri(), code_verifier: pending.verifier })
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  const identity = await this.options.identify(accessToken)
  if (!identity || identity.productId !== this.options.clientId) throw new SignInFailed('auth did not say who signed in')
  // The context keeps no token: who signed in is all it needed. Giving them back ends them.
  if (typeof tokens.refresh_token === 'string') await this.post('/oauth/revoke', { token: tokens.refresh_token })

  const { session, token } = WebSession.open(identity.userId, this.options.days)
  await this.repo.persist(session)
  return { token, returnTo: pending.returnTo }
}
```

Notice `retryOnConflict: false`. Chapter [7](./07-concurrency) explains it.

A route that anyone may call says so with `{ public: true }`. Every other route needs
a session:

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
// Public: signing out with a session already gone still clears the cookie.
base.http.post('/session/sign-out', async request => {
  await sessions.signOut(request.cookies.get(cookies.session) ?? undefined)
  request.cookies.delete({ name: cookies.session, path: '/' })
  return new Response(null, { status: 204 })
}, { public: true })
```

The MCP server authenticates differently, with a bearer token checked in-process by
auth's `token.verify` (chapter [21](./21-mcp-server)). The idea is the same: find out
who it is, then run as them with `runAsActor`.

### Check it

`web-session.test.ts` runs auth and a small client context on two ports and walks a
browser through the whole sign-in:

```ts
// cooper/backend/shared/web-session/web-session.test.ts
// Back in the client: the code is traded over HTTP, and the browser goes where it was going.
const back = await as(redirectTo)
expect(back.status).toBe(302)
expect(back.headers.get('location')).toBe('/boards/1')
expect(await (await as(clientUrl('/api/session'))).json()).toMatchObject({ id: ana.id, email: 'ana@cooper.test' })
expect(await (await as(clientUrl('/api/whoami'))).json()).toEqual({ userId: ana.id })
// It keeps no token: it gave them back once it knew who signed in.
expect(await auth.base.store.table('token').count()).toBe(0)
```

With cooper running (`bun run cooper`), a request without the cookie is refused:

```bash
curl -i http://localhost:3002/api/workspaces
# HTTP/1.1 401 Unauthorized
# {"error":"…","code":"not_signed_in"}
```

## Authorization: may they do this

Knowing who someone is does not say what they may do. **The module that knows** decides,
and it is asked **every time**, from the use case.

In `boards`, the question is "does this person belong to this workspace?". Workspaces
and their members are auth's (a workspace is an auth *tenant*; its members are those
with access to it). `boards` asks through a **port**, a type in its own words:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
export type Workspaces = {
  /** Whether someone belongs to a workspace now: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
}
```

Whoever opens the contexts wires it to auth's `access.check`:

```ts
// cooper/backend/open-contexts.ts
workspaces: {
  isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
  // …
},
```

And the `member` module of `boards` turns the answer into a use case:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
/**
 * The workspace scope for the signed-in person, if they belong to it: what a route
 * under `/workspaces/:workspaceId` runs in. To anyone else it does not exist (404,
 * not 403: a private thing does not own up to existing).
 */
@UseCase()
async enter(workspaceId: string): Promise<WorkspaceScope> {
  if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
  return { workspaceId }
}
```

Three decisions, and why:

- **Permissions are not in the actor.** The actor is computed when the request comes
  in. If it carried the permissions, removing someone from a workspace would not count
  until their next session. Asking the module each time, it counts at once.
- **The use case asks, not the route.** So the check holds the same from HTTP, a
  script or an MCP tool: there is no back door that forgot to check.
- **404 to strangers, 403 to members.** Whoever does not belong to a workspace is told
  it does not exist. A private thing never owns up to existing:

```ts
// cooper/backend/contexts/boards/modules/member/errors/workspace-not-found.ts
/** A workspace the person does not belong to, or that does not exist: to them, the same thing. */
export class WorkspaceNotFound extends NotFoundError {
  readonly code = 'workspace.not_found'
  // …
}
```

A member who tries what only the admin may do already knows the workspace exists.
Hiding it would make no sense: they get a 403, with an error that extends
`ForbiddenError`.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/** The signed-in person is its admin. Who is not even a member is told it does not exist. */
private async assertAdmin(tenantId: string): Promise<void> {
  const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
  if (!access) throw new TenantNotFound(tenantId)
  if (access.role !== 'admin') throw new NotTenantAdmin()
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/errors/not-tenant-admin.ts
/** A member who is not the workspace's admin, trying what only the admin may do. */
export class NotTenantAdmin extends ForbiddenError {
  readonly code = 'tenant.not_admin'
  // …
}
```

### Check it

cooper's end-to-end test runs every context with the real auth, and shows the three
answers:

```ts
// cooper/backend/cooper.test.ts
// A member works in it, but only its admin renames it, invites or deletes it.
expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
// …
// Somebody else, signed in, is told it does not exist.
const eve = await signUp('eve@cooper.test', 'Eve')
expect(await call(eve.as, 'GET', `/workspaces/${acme.id}/members`)).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
expect((await call(browser(), 'GET', '/workspaces')).status).toBe(401)
```

## Scopes: working inside a workspace

Almost everything in `boards` happens **inside a workspace**: its boards, their
columns, their cards. You could pass a `workspaceId` to every use case and check
membership in each one… and forget it in one.

newt lets you define **scopes**: a value that travels with the work, like the actor.
It is set once where the work comes in, and read anywhere below. The actor is one;
your app defines the rest with `defineScope`:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** The workspace the work in progress is about: an auth tenant, by its id. */
export type WorkspaceScope = {
  workspaceId: string
}

export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

/** The id of the workspace the work in progress is about; throws outside one. */
export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}
```

A scope has three methods: `run(value, fn)` runs `fn` inside it, `current()` reads it
(and throws if there is none), and `find()` reads it if there is one.

### The group and its middleware

Routes that share a prefix can share a **middleware** with `http.group`. It runs after
the session is checked, around every route of the group. It may answer itself (an
error) or go on with `next()`. Here it goes on inside the workspace:

```ts
// cooper/backend/contexts/boards/workspace-routes.ts
/**
 * The routes about one workspace, under `/api/workspaces/:workspaceId`: each one runs
 * in that workspace once `member.enter` has checked the signed-in person belongs to it
 * (404 for anyone else), so no use case below has to, nor can forget to. Every module
 * of `boards` registers its routes on it.
 */
export function workspaceRoutes(base: BoardsBase, members: Member_Module) {
  return base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await members.enter(request.params.workspaceId), next))
}
```

Each module registers its routes on that group, and they look like any route:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
export function registerBoardRoutes(base: BoardsBase, boards: Board_Module, deps: Board_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })
  // …
}
```

Membership is checked **once**, for every route of the group. And no use case can
forget it: outside a workspace, `currentWorkspaceId()` throws instead of returning
nobody's boards.

### The repository's scope

Something can still be forgotten: adding the `workspaceId` to every query. If the rows
of a table belong to a workspace, tell the repository with `scope`, and it does it in
all of them:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
constructor(base: BoardsBase) {
  super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
    // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
    softDelete: true,
    // Every find, count and page sees the current workspace's boards only.
    scope: { field: 'workspaceId', current: currentWorkspaceId },
  })
}
```

And the use case never names the workspace when it reads:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** A page of the workspace's boards, the newest first. */
@UseCase()
async list(page: PageRequest): Promise<Page<BoardDTO>> {
  const found = await this.repo.page({}, page, { newestFirst: true })
  // …
}
```

It only says it once, when it makes something new: a new board belongs to the
current workspace.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
```

What the scope gives you:

- `find`, `first`, `count` and `page` **see only the current workspace's rows**,
  whatever their criteria say. A board of another workspace is "not found".
- Saving an entity of **another** workspace is an error, not a write.
- **Outside a scope, `current()` throws**, and the repository reads nothing.
- What looks across workspaces **on purpose** uses `findInEveryScope`, a protected
  method: it stays inside the repository, with a name a review notices.
- What is protected is **those methods**. What the repository reads or writes on its
  own (`this.table`, Kysely, `saveRows`, the `after` of a save) filters by itself.
  The card search does it with Kysely:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
const matching = await this.base.db
  .selectFrom('card')
  .select('id')
  .where('workspaceId', '=', currentWorkspaceId())
  // …
```

### Entering a scope without a route

What does not come through the router enters the scope on its own, with `run`.
`workspace-scope.ts` gives two ways:

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
/** Runs in a workspace without checking who may: for workers and scripts, which already know. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return workspaceScope.run({ workspaceId }, fn)
}

/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
```

- **An MCP tool** acts for a person and names a workspace: it enters with
  `inWorkspace`, which checks membership exactly as the group does.
- **A worker** never inherits a scope: it runs on its own, later. It knows its
  workspace from its event, and enters it with `runInWorkspace`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign()
    await this.repo.persist(...cards)
  })
}
```

- **Another context** (the backoffice) names the workspace too, and a use case for it
  enters it:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
@UseCase()
async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
  return runInWorkspace(workspaceId, () => this.list(page))
}
```

### Check it

The tests enter a workspace as a person, the way a route does:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
as<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return runAsActor({ userId }, () => inWorkspace(boards.modules.member, workspaceId, fn))
},
```

And check that nobody sees another workspace's boards:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('shows a workspace\'s boards to its members only, and nobody else\'s', async () => {
  const roadmap = await create('Roadmap')

  await expect(t.as('bea', 'globex', () => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
  await expect(t.as('bea', 'acme', () => t.modules.board.list({ size: 10 }))).rejects.toMatchObject({ code: 'workspace.not_found' })
  expect((await t.modules.board.listOf('acme', { size: 10 })).items.map(board => board.id)).toEqual([roadmap.id])
})
```

Through HTTP, in `boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
test('lets only a workspace\'s members in, and tells nobody else it exists', async () => {
  expect((await call('GET', '/acme/boards', undefined, null)).status).toBe(401)
  expect(await call('GET', '/acme/boards', undefined, 'bea')).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
  expect(await call('GET', '/acme/boards')).toMatchObject({ status: 200, body: { items: [], total: 0 } })
})
```

## When you need nothing more

Scopes are **optional**, and your app defines them: newt does not know what a
workspace is. `auth` defines none: the actor is enough there, and its use cases
receive the tenant's id and check access themselves. `boards` has the actor and a
workspace. Another app may have the actor and a store, or a customer. Each defines
the ones it needs, with the same three pieces: `defineScope`, `http.group` and `run`.

## In short

- A use case knows who acts with `currentActor()`. Never take a user id as a parameter
  for "mine".
- Authentication is a use case of the module that keeps the sessions; the router calls
  it through `authenticateWith`. Store only the hash of a token.
- Authorization is asked of the module that knows, every time, from the use case. Never
  put permissions in the actor.
- 404 to whoever does not belong; 403 to a member who may not.
- Define a scope for what most of the work happens inside. Enter it once: in a group's
  middleware, with `inWorkspace` for an MCP tool, with `runInWorkspace` in a worker.
- Give the repository its `scope`, so no query forgets the workspace. Filter by hand
  only in what the repository reads on its own (Kysely, `this.table`).
