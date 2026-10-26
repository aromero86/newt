# Several contexts

cooper has three contexts:

- **auth**: who someone is. Accounts, workspaces (its tenants), who may enter what,
  and the OAuth server every app signs in with. It uses no other context.
- **boards**: the SaaS. Each workspace's boards, columns and cards, on the web and
  through MCP. It uses auth.
- **backoffice**: the staff's console. It reads auth and boards.

Each one is a `BoundedContext` with its own store (its own SQLite file), its own
modules and its own server, on its own port. In production, each gets its own
domain, so its cookies are its own too.

## Who uses whom, without circles

Contexts depend on each other like modules do: never in a circle. The lint config
says who may import whom, and `bun run lint` fails otherwise:

```js
// eslint.config.js
contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
```

And `openContexts` opens them in that order, each after those it uses, handing it
what it needs:

```ts
// cooper/backend/open-contexts.ts
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  // …
  const tracer = config.trace ? new ConsoleTracer() : undefined
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

// …

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
```

The server (`index.ts`), the seed and the end-to-end test all open cooper through
this one function. They can't get the order wrong.

## One tracer for all of them

Each context opens with its own base, but they all get **the same tracer**. With
`COOPER_TRACE=1`, `openContexts` makes one `ConsoleTracer` and hands it to the three
(`tracer` in the code above). The contexts run in one process, so one tracer sees
them all.

A trace is the use case called from outside, with every use case it called inside
it, each one with its context's name and how long it took. One tracer means one tree:
when a backoffice use case asks auth for a user, auth's `user.get` shows up indented
inside it, not as a separate trace. The tracer's test shows the shape of what it
writes:

```ts
// cooper/backend/shared/observability/console-tracer.test.ts
expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
  '[trace] backoffice workspace.get n ms',
  '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
  '[trace]   broken n ms (error: disk full)',
])
```

```bash
COOPER_TRACE=1 bun run cooper
```

With tracing on, boards also gets a `log`: its `activity` module writes a console
line each time a card moves.

`ConsoleTracer` is newt's `Tracer`, the same interface an OpenTelemetry adapter
implements. Swap it, and the contexts don't change ([chapter 26](./26-production)).

## A context reaches another only through its use cases and events

Never through its store. boards never reads auth's tables, and has no idea auth runs
on SQLite. It gets two kinds of things from auth:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  auth: Boards_Auth
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}
```

- **Ports** (`workspaces`, `tenants`, `access`): what boards' own modules need, in
  boards' words ([chapter 17](./17-modules-talk)). boards' tests hand fakes.
- **auth's use cases** (`auth`): the ones boards calls as they are. Who an access
  token is for (the web session and the MCP server), who someone is, and what the
  workspace routes manage.

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export type Boards_Auth = Pick<Auth_Modules, 'token' | 'user' | 'tenant' | 'access' | 'invitation'>
```

Which product a workspace belongs to is a name auth declares, next to its products,
and the other contexts import it from there:

```ts
// cooper/backend/contexts/auth/modules/product/product.schema.ts
/**
 * The ids of cooper's products, which other contexts name when they ask auth about
 * them: `cooper` (the boards) and `backoffice` (the staff's console).
 */
export const PRODUCTS = { cooper: 'cooper', backoffice: 'backoffice' } as const

/** The product whose workspaces the tenants are: boards, the SaaS. */
export const WORKSPACES_PRODUCT = PRODUCTS.cooper
```

It is a constant, not a module: importing it gives boards no way into auth's data.

`boardsOnAuth` wires the ports to auth. It is where boards' words become auth's: a
workspace is a tenant of the product `cooper`, and a member is someone with access to
it:

```ts
// cooper/backend/open-contexts.ts
/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer' | 'log'> {
  const { access, user, tenant, token, invitation } = auth.modules
  return {
    workspaces: {
      isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
      member: async (workspaceId, userId) => {
        if (!await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) return null
        const [found] = await user.getMany([userId])
        return found ? { id: found.id, name: found.name, email: found.email } : null
      },
      // A deleted tenant is not among them.
      exists: async workspaceId => (await tenant.getMany([workspaceId])).length > 0,
    },
    tenants: tenant.events,
    access: access.events,
    auth: { token, user, tenant, access, invitation },
  }
}
```

auth's emitters fit the event ports as they are: a port only asks for `subscribe`.
And each answer of the `Workspaces` port is a call to one of auth's use cases:
`exists`, which a worker asks before writing in a workspace that may be gone, is
`tenant.getMany`, which leaves deleted tenants out.

## Calling another context is calling an external API

What auth saves stays saved, whatever happens afterwards in boards. A boards
transaction that fails later doesn't undo it. Treat the call like a call to a
payment provider:

- **Call it after whatever can fail** on your side.
- **Make the call safe to repeat.**

That is also why the write rule ([chapter 17](./17-modules-talk)) **does not cross
contexts**. A use case you call in another context is the **root** of what it does
there, as if someone outside had called it. newt's invocation chain says so:

```ts
// packages/newt/core/use-case/invocations.ts
// Called from another context, it is that context's API: the root of what it does here.
// Within one, a use case's writesTo counts for what is written below it, however deep.
const root = chain && chain.root.context === link.context
  ? (writesTo.length ? { ...chain.root, writesTo: [...chain.root.writesTo, ...writesTo] } : chain.root)
  : { ...link, writesTo }
```

Inside auth, `tenant.create` may write to `tenant` (its own module) and to `access`
(its `writesTo`), and the rule holds as always.

## boards' workspace routes: entry points into auth

Workspaces, their members and their invitations belong to auth. But people manage
them from boards' UI, on boards' origin, with boards' session cookie. So boards has
routes for them, and **each route calls auth's use case directly**:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
// Workspaces, their members and their invitations are auth's. boards' UI manages them
// through boards' own origin, and these routes call auth's use cases directly: each
// route is an adapter, an entry point like any client's, and what it writes starts
// in auth, under auth's own rules (who is admin, the single admin, the write rule).
// No use case of boards writes in auth: boards only reads it (`mine`, `members`), and
// hears what auth did through its events, from a worker (a new workspace's board).

base.http.get('/workspaces', async () => Response.json(await workspaces.mine()))

base.http.post('/workspaces', async request => {
  const created = await tenant.create(await request.json() as TenantCreateDTO)
  return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
})

// The rest is about one workspace: a member's (404 for anyone else), and auth checks the admin.
workspace.patch('', async request => {
  const renamed = await tenant.rename(request.params.workspaceId, await request.json() as TenantRenameDTO)
  return Response.json(workspaceOf(renamed, currentActor().userId))
})

// …

// Its admin removes someone, or a member leaves: their cards are unassigned a moment later.
workspace.delete('/members/:userId', async request => {
  await access.revoke({ userId: request.params.userId, productId: WORKSPACES_PRODUCT, tenantId: request.params.workspaceId })
  return noContent()
})
```

A route is not a use case. It is an adapter, like auth's own routes. So the chain
starts in auth: `tenant.create` is its root, and auth's rules guard it (who is
admin, the single admin, the write rule). The request runs as the person signed in
to boards, so auth's `currentActor()` is them.

Why not a boards use case, say `workspace.create`, that calls `tenant.create`? newt
would allow it: the call would be the root in auth. But then a boards use case would
write in two stores. If it did anything in boards after the call and that failed,
auth's part would stay, and nobody would finish boards' part. cooper keeps a simple
rule instead:

> **No boards use case writes into auth.** boards' use cases only *read* auth
> (`workspace.mine`, `workspace.members`). Writes into auth start at a route.
> boards hears what auth did through events, from a worker.

## Events across contexts

A new workspace gets its welcome board. auth creates the tenant and publishes
`tenant.created`. boards subscribes to it, through the `TenantEvents` port, which is
auth's emitter:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.purge.on.tenant.deleted',
    // The workspace is gone in auth already: a purge that keeps failing must not die soon.
    attempts: 10,
  })
}
```

Where do those jobs run? A subscription on auth's emitter is **a job of auth's
outbox**. It is saved in auth's store, in the same transaction as the tenant, and
**auth's worker** runs it. The use case it calls, `workspace.prepare`, writes in
boards' store. It may: it runs from a worker, so the write rule lets it write to
`board`, `column` and `card`.

This has one consequence for tests and scripts: to wait for everything, wait for
auth's jobs first (boards' reactions to auth are among them), then boards' own (what
those reactions made boards tell):

```ts
// cooper/backend/cooper.test.ts
/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}
```

## backoffice

backoffice opens last. It is not handed the two contexts it reads, only their
modules, and of those only the ones it uses:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}
```

`openContexts` passes `auth.modules` and `boards.modules`, and the `Pick` narrows them.
Never a context's base, never its store: with only modules in hand, backoffice can
reach auth and boards through their use cases and nothing else. And the list says
what it touches: backoffice knows nothing of boards' columns, auth's invitations or
OAuth grants. If one day it needs `column`, the change shows up in this type.

The two `outbox` entries are the shared module each context has for its dead jobs:
backoffice lists them and retries them for the staff, through each context's own use
cases.

Its modules come in [chapter 22](./22-backoffice). They follow the same rules: they
read auth and boards through their use cases, and change them only through those.

## How to check it

cooper's end-to-end test opens the three contexts as the server does, on SQLite in
memory, and drives boards over HTTP as its UI would. Creating a workspace goes
through boards' route into auth, and the welcome board arrives a moment later:

```ts
// cooper/backend/cooper.test.ts
const created = await call<Workspace>(as, 'POST', '/workspaces', { name: 'Acme' })
expect(created).toMatchObject({ status: 201, body: { name: 'Acme', adminId: id, isAdmin: true } })
const acme = created.body
expect((await call(as, 'GET', '/workspaces')).body).toEqual([acme])
expect((await call(as, 'GET', `/workspaces/${acme.id}/boards`)).body).toMatchObject({ total: 0 })

await settled()
const welcome = await welcomeOf(as, acme.id)
expect(welcome.board.name).toBe('Welcome')
```

And only the admin manages it: auth's rule answers through boards' route.

```ts
// cooper/backend/cooper.test.ts
expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
```

```bash
bun test cooper/backend/cooper.test.ts
```

## In short

- **Each context has its store**, its modules and its server, on its port.
- **Contexts depend on each other without circles.** Each opens after those it uses,
  and stops before them. Lint enforces who may import whom.
- **A context reaches another only through its use cases and events.** What it needs
  for its own logic, it takes as ports, in its own words. What it calls as is, it
  takes as a `Pick` of the other's modules: never the context, its base or its store.
- **One tracer for every context**: a call into another context shows up inside the
  use case that made it.
- **Calling another context is calling an external API**: after what can fail, and
  safe to repeat. The called use case is the root of what it does in its context.
- **Writes into another context start at a route**, an entry point. No use case of
  yours writes into another context. Reactions go through events and workers.
- A subscription on another context's emitter is a **job of that context's outbox**,
  run by its worker. Wait for its jobs first.
