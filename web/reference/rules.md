# The rules of newt

How an application is built on newt: its contexts, its modules and the rules they
follow, with the API each rule is written in. The guide teaches them one at a time,
building cooper; this page puts them all in one place, and every example comes from
cooper's backend. How data is kept, and how to keep it somewhere new, is in
[Stores](./stores). What the lint checks is in [Lint](./lint).

## Contexts

An application is one or more bounded contexts. Each one owns its store, its modules
and, if it has any, its entry points. cooper has three: `auth`, `boards` and
`backoffice`.

```ts
// cooper/backend/contexts/boards/boards.context.ts
static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new BoardsBase({ name: 'boards', store, tracer })
  return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
}
```

- **Each context picks its store** and opens it up to date (opening applies the
  pending migrations, the context's and then the framework's own), then builds its
  `Base` on it. `Base` gives every module the store, the `invocations` of its use
  cases, the event `bus`, the `publisher` its repositories publish to, and the `jobs`
  of its `handler` subscriptions. Its options are `name`, `store`, and optionally a
  `tracer`, the `jobs` settings and the `writeRule`.
- **An application gives its modules more by extending `Base`**: an HTTP router, a
  mailer, a query builder on the store's connection.

  ```ts
  // cooper/backend/shared/cooper-base.ts
  export class CooperBase extends Base<SqliteStore> {
    readonly http = new HttpRouter()
  }
  ```

  ```ts
  // cooper/backend/contexts/boards/boards-base.ts
  export class BoardsBase extends CooperBase {
    readonly db = kyselyFor<BoardsDatabase>(this.store)
  }
  ```
- **A context is a `BoundedContext`**: `start()` starts its job worker, `stop()` waits
  for the jobs in progress and closes its store. How it is served is the
  application's: `serve` from `newt/http` is one way, and cooper's `ServedContext`
  uses it.
- **Contexts depend on each other without a cycle**: each one is opened after the ones
  it uses and receives their modules, or ports made of them.

  ```ts
  // cooper/backend/open-contexts.ts
  const tracer = options.tracer ?? (config.trace ? new ConsoleTracer() : undefined)
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  ```
- A context reaches another only through that one's use cases and events, never its
  base or its store. Its deps type says which modules, as a `Pick`, so nothing else is
  within reach:

  ```ts
  // cooper/backend/contexts/backoffice/initialize-modules.ts
  export type Backoffice_ModuleDeps = {
    auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
    boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
  }
  ```

  A call to another context is like a call to an outside API: what it saved
  stays saved whatever the caller does next, so the caller puts it after whatever may
  still fail, and makes it safe to run again.

## Entry points

- An entry point translates a request into a use case call, and its result into a
  response. **No business logic in an entry point.**
- With `newt/http`, each module registers its routes on the context's `HttpRouter`
  (`<m>.routes.ts`), all under one prefix (`/api` by default, `new HttpRouter({
  prefix })` for another). A route's path types its params (`/boards/:boardId` gives
  `request.params.boardId`).

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.routes.ts
  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })

  workspace.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))
  ```
- **Whatever a route throws becomes a response**: a domain error with its status and
  code (`{ error, code }`), an invalid input a 400 (a body that cannot be read,
  `malformed_body`, or one that fails the use case's schema, `validation`, with zod's
  `issues`), anything else a 500 that says nothing about the inside. An entity that
  fails its own schema (`InvalidEntity`) is a programming error, so a 500 too. A JSON
  body must come as `application/json` (or `…+json`); any other `Content-Type` is a
  415, `unsupported_media_type`, so a form posted from another site never reaches a
  route. A path under the prefix with no route is a 404, a method a path does not
  have a 405.
- **Every route needs a session** unless it is registered with `{ public: true }`.
  The router asks its `Authenticator` who sent the request, and the route runs as that
  actor: any use case it reaches knows who is doing it through `currentActor()`.
  Never pass the user id around by hand. Any other entry point (a CLI, an MCP server,
  a script) runs as an actor the same way, with `runAsActor`.

  ```ts
  // cooper/backend/shared/served-context.ts
  base.http.get('/health', () => Response.json({ status: 'ok', context: name }), { public: true })
  ```

  ```ts
  // cooper/backend/contexts/boards/mcp/mcp.ts
  return await runAsActor({ userId: identity.userId, via: 'mcp' }, () => transport.handleRequest(request))
  ```
- **Routes that share a prefix may share a middleware**: `http.group(prefix,
  middleware)`. It runs after the session is checked, around each route of the group,
  and may answer instead or go on with `next()`, typically inside a scope of its own
  (see [Who and where](#who-and-where-the-actor-and-other-scopes) below). A route's
  params are its group's and its own.
- Routes outside the router (an MCP entry, a `/.well-known` document) go beside it:
  `serve({ port, router, routes, frontend })` serves the router's routes, the ones
  given in `routes`, and a built frontend for every other address.

## Who and where: the actor and other scopes

**The actor** is who is doing what is being done. The framework only knows its
`userId`. An application that needs more adds it by augmenting the `Actor` interface,
once, in a file every program of the application loads. cooper adds how the person
came in, through its web apps or through an AI assistant:

```ts
// cooper/backend/shared/actor.ts
import 'newt/core'

/**
 * How someone reached cooper: its web apps, with a session cookie, or an AI assistant
 * through boards' MCP server, with an access token.
 */
export type ActorVia = 'web' | 'mcp'

// …
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

`CooperBase` imports that file (`import './actor'`), so every program that opens a
context has it. From then on `currentActor()` returns those fields, and every place
that says who acts must give them: the authenticator, `runAsActor`. A required field
cannot be forgotten; the compiler finds every place. Keep it to who someone is and how
they came, never what they may do. Outside any actor, `currentActor()` throws `NoActor`, a 401;
`findCurrentActor()` returns `undefined` instead, for what anyone may do and a signed-in person sees more of.

**Authentication** (who is it) is the router's `Authenticator`: it reads the request
(a session cookie, a token) and asks a module of sessions, through a use case, who
that is.

```ts
// cooper/backend/shared/web-session/web-session.routes.ts
base.http.authenticateWith(request => sessions.authenticate(request.cookies.get(cookies.session) ?? undefined))
```

A session stores only the hash of its token (`SecretToken.hash`), so a copy of the
database opens nothing:

```ts
// cooper/backend/shared/web-session/web-session.ts
static open(userId: string, days: number): { session: WebSession, token: SecretToken } {
  const token = SecretToken.generate()
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
  return { session: new WebSession({ userId, tokenHash: SecretToken.hash(token), expiresAt }, true), token }
}
```

**Authorization** (may they do this) is never in the actor: a use case asks the
module that owns that knowledge, every time, so a permission taken away counts at
once. Whoever is not a member gets a 404, not a 403: a private thing never says it
exists.

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
@UseCase()
async enter(workspaceId: string): Promise<WorkspaceScope> {
  if (!await this.deps.workspaces.isMember(workspaceId, currentActor().userId)) throw new WorkspaceNotFound(workspaceId)
  return { workspaceId }
}
```

**Other scopes.** A value that travels with the work like the actor (the workspace a
request is about, a tenant) is a scope the application defines with `defineScope`.
A scope has `run(value, fn)`, `current()` (which throws outside it, with the error
given as `missing`, if any) and `find()` (which gives `undefined` instead).

```ts
// cooper/backend/contexts/boards/workspace-scope.ts
export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}
```

```ts
// cooper/backend/contexts/boards/workspace-routes.ts
export function workspaceRoutes(base: BoardsBase, members: Member_Module) {
  return base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await members.enter(request.params.workspaceId), next))
}
```

The middleware checks membership once for all the group's routes, and no use case can
forget to: without a workspace in scope, `current()` throws. Whatever does not come
through the router (a worker, a script, an MCP server) enters it itself with
`run(...)`; a worker knows which from its event. cooper wraps both ways in
`inWorkspace` (checks membership, for MCP tools) and `runInWorkspace` (no check, for
workers and scripts). An application with only users defines nothing: the actor is
enough.

A repository whose rows belong to a workspace says so once, and then none of its own
queries can forget the filter (the entity carries the `workspaceId` too):

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
  softDelete: true,
  scope: { field: 'workspaceId', current: currentWorkspaceId },
})
```

`find`, `first`, `count` and `page` see only the current workspace's rows; saving an
entity of another one, or one stored in another, throws; outside a scope `current()`
throws, so a worker enters it first. What looks across workspaces on purpose uses the
protected `findInEveryScope`, behind a method whose name says so, reached by no route
of the workspace's own people:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
/**
 * The boards created last, in every workspace: for the staff, who look across them
 * on purpose. Archived ones stay out.
 */
recentInEveryScope(limit: number): Promise<Board[]> {
  return this.findInEveryScope({}, { limit, orderBy: [{ field: 'id', direction: 'desc' }] })
}
```

What a subclass reads or writes on its own (`this.table`, Kysely, `saveRows`, a save's
`after`) adds the filter itself, as cooper's card search does with
`.where('workspaceId', '=', currentWorkspaceId())`.

## Modules

### One responsibility

A module owns one thing: its data, the rules about that data, and what happens when
it changes. If describing a module needs an "and", it is two modules. A module is not
a table and not a screen: it is a responsibility.

**The module's entity has the module's name** (`board` → `Board`). An entity named
otherwise is a second responsibility, and goes to a module of its own.

**Modules on the same subject share a prefix**, so they sit together: in cooper's
auth, `oauth-client` and `oauth-grant`. The prefix is part of the name everywhere
(`OauthGrant_Module`, entity `OauthGrant`, table `oauth_grant`, use case
`oauthGrant.redeem`), and each one is still a module of its own.

### Anatomy

`<context>/modules/<module>/` (kebab-case):

| File | What it holds |
|---|---|
| `<m>.schema.ts` | Zod schemas and DTO types: the module's **public contract**, what goes in and out of its use cases and events. Everything it exports starts with the entity's name (`BoardSchema`, `BoardCreateDTO`). |
| `<m>.ts` | The entity: a class extending `Entity<typeof <M>Schema>`. Re-exports the schema file. |
| `<m>.repository.ts` | **The only file that touches the store.** |
| `<m>.module.ts` | `<M>_Module extends Module`: the use cases and its `events`. `static initialize(base, deps?, options?)`. |
| `<m>.routes.ts` | Its routes, when it has any. |
| `<m>.workers.ts` | What it does **in reaction** to events: its own or its dependencies'. |
| `<m>.deps.ts` | `<M>_Deps`: the modules it depends on, imported with `import type`. |
| `<m>-options.ts` | `<M>_Options`: settings it takes at `initialize`. |
| `value-objects/<name>.ts` | Values with rules of their own that only it uses. |
| `errors/<error>.ts` | One class per domain error. |
| `events/<m>-<verb>.ts` | One class per domain event. |
| `services/<name>.ts` | Logic its use cases share, one file each. |
| `*.test.ts` | Tests, next to what they test. |

[`newt-eslint`](./lint) checks it, with how modules reach each other and how a
handler's queue is named.

Naming: folder `oauth-grant`, class `OauthGrant_Module`, table `oauth_grant`, child
table `oauth_grant__<child>`, use case `oauthGrant.redeem`, event `card.assigned`,
error file `board-not-found.ts`.

### How modules talk

Exactly two ways, and the choice is about meaning:

- **A call to a use case**, when the caller needs its answer now: **reads and
  checks**, from anywhere. (Never call one from a save's hook: it would run in that
  save's transaction.)
- **An event**, when something is a *consequence* of something else. The publisher
  does not know who listens.

**Writing to another module happens only from a worker** reacting to an event, never
from the middle of a use case's own work. Each module's save is a transaction of its
own: if one use case saved in two modules and failed between the saves, the first
would stay saved with nothing to finish the work. A worker's job, instead, runs again
until it completes; what it writes is safe to run again (idempotent), so the flow
always converges.

| Writing to another module from… | If it fails halfway… |
|---|---|
| a use case outside a worker (a request, a script, a test) | it stays half done, and nothing finishes it |
| a use case a worker called (a `handler`) | its job runs again until it completes |

The framework checks it as it runs: a use case of module B that saves, called under a
use case of module A outside a worker, is an error (the default), or a warning
(`writeRule: 'warn'` in a context's `Base`, while an application moves to the rule;
`'off'` checks nothing). Reaching B's repository from A, past its use cases, is what
`newt-eslint` refuses. An exception that is justified is said where it is seen, with
the reason beside it:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Removes a column of a board, only if no card is in it. The cards answer, since a
 * card points at its column and a column knows nothing of the cards: the column
 * module cannot ask them without the two needing each other. So this use
 * case asks, and has the column module remove it: a write to another module outside
 * a worker, said where it is seen. It is the only write it makes, so a failure leaves
 * nothing halfway; a card moved into the column at that very moment is taken to
 * another one by `leaveRemovedColumn`.
 */
@UseCase({ writesTo: ['column'] })
async removeColumn(columnId: string): Promise<void> {
  const column = await this.deps.column.get(columnId)
  const cards = await this.repo.count({ columnId })
  if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
  await this.deps.column.remove(column.id)
}
```

A `writesTo` counts for whatever is written below that use case, whoever called it.
The rule is per context: a use case called from another context is that context's
API, the root of what it does in its own, where the rule holds as for any other. (A
boards route that calls `auth.modules.tenant.create` starts a chain in auth.)

**A module is one aggregate.** What must be saved together, all or nothing, is one
module. Two modules whose data must always change together are one; otherwise one of
them follows the other through events.

- A module that **knows** another (it is in its `<M>_Deps`) may call its use cases and
  subscribe to its events. Never its repository, its tables or its entity: reads go
  through the owner's use cases.

  ```ts
  // cooper/backend/contexts/boards/modules/card/card.deps.ts
  export interface Card_Deps {
    board: Board_Module
    column: Column_Module
    member: Member_Module
    access: AccessEvents
  }
  ```
- **Dependencies never form a cycle.** When two modules seem to need each other, one
  stops calling and starts listening. (`column` does not know the cards; `card` knows
  the columns and follows `column.removed`.)
- A module never knows who depends on it.
- What a module needs of another context is a port, in its own words, typed in its
  deps file (`AccessEvents` above); the context hands it the other context's use cases
  or emitters when it opens.

## The entity

The entity is a schema plus behaviour. The zod schema is the single source of truth
for its shape; `Entity` keeps the data valid and tracks what changed.

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
export class Board extends Entity<typeof BoardSchema> {

  private constructor(input: EntityInput<BoardDTO>, isNew: boolean) {
    super(BoardSchema, input, isNew)
  }

  static fromDTO(dto: BoardDTO & { version: number }): Board {
    return new Board(dto, false)
  }

  static create(input: { workspaceId: string, name: string, description: string }): Board {
    const board = new Board({ ...input, name: BoardName.from(input.name) }, true)
    board.trackEvent(new Board_Created(board.toDTO()))
    return board
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Board_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  archive(): void {
    this.markAsDeleted()
    this.trackEvent(new Board_Archived(this.toDTO()))
  }
}
```

- `create` for something new, `fromDTO` for something stored: `isNew` is decided by
  which one is called, never by whether an id is present. A new one gets its id
  (UUIDv7), `createdAt` and `updatedAt`.
- **Only the entity changes itself**: `change()` is protected, so a use case calls the
  entity's methods (`update`, `archive`…), which say what happened with
  `trackEvent`. `change()` checks the whole entity against the schema (its refinements
  too), keeps the values it parses to (trimmed, defaulted…), ignores values that did
  not actually change, and moves `updatedAt` on when something did. A field the schema
  does not have, or a change to a deleted entity, throws.
- Rules about the entity's own data live in its methods; rules that need other data
  live in the use case.
- **Its methods take domain data, not the input DTO.** The DTO is the API's contract
  (what a client sends, before it is checked); the entity gets what it needs to be
  born, checked and often completed by the use case: a card is created with its
  board's workspace, its number and its position, which no client sends. Small inputs
  go inline (`{ workspaceId, name, description }`); one that deserves it is a type with
  a business name in the entity's file, never a `…DTO` and never in the schema file:

  ```ts
  // cooper/backend/contexts/boards/modules/card/card.ts
  export type CardOpening = {
    workspaceId: string
    boardId: string
    columnId: string
    number: number
    position: number
    title: string
    description: string
    assigneeId: string | null
  }
  ```
- **Each kind of thing is told once per save, as it stands.** An event replaces an
  earlier one of its name not yet saved, so two `update` calls before a save make one
  `updated`, with both changes; and if the second undoes the first, the save writes
  nothing and tells nothing. An event always comes with a change: an entity that
  changes nothing publishes nothing. Two different kinds in one save (`created` and
  `updated`) usually mean the use case does two things.
- **`getChanges()` and `getPrevious()`** are the transition a save makes: the fields
  that changed, as they are now and as they were when it was read.
- **It is validated twice, on purpose.** The use case validates what comes in (its
  input schema, lenient, a 400 for the client); the entity validates its state
  (strict, on every change, and on what is read from the store; failing it is a
  programming error, `InvalidEntity`, a 500). One rule, written once: the input schema
  is derived from the entity's (`CardSchema.pick({ columnId: true, title: true })`,
  `CardSchema.shape.title`).
- **It has a `version`**: 0 until it is saved, then the one it is stored with.
  `fromDTO` gets it from the row (the constructor throws without it, since saving it
  could overwrite someone), and the repository moves it on as it writes it, and back
  if the save rolls back.
- **A store keeps "no value" as `null`**: a field cleared to `undefined` is written as
  `null`, and read back as `null` if its schema takes it (`.nullable()`, `.nullish()`),
  or left out if it is only `.optional()`.
- Outside its module an entity does not exist: use cases return `toDTO()`.

## Repositories

A repository is the only place that reads and writes a module's entities.

**`TableRepository`, when the entities are the rows of one table**, on any store: say
how a row becomes an entity, and `find`, `first`, `count`, `page` and `persist` come
done.

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      softDelete: true,
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }
  // …
}
```

What to find is said with **criteria**, field by field, which every store
understands:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
const found = await this.repo.page({}, page, { newestFirst: true })
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(tenant => tenant.toDTO())
```

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
return toDTOs(await this.repo.page({ userId, productId }, page, { newestFirst: true }))
```

A field set to a value must equal it (`null` is "has none"). The operators are `eq`,
`ne`, `in`, `gt`, `gte`, `lt`, `lte` and `ieq` (equal, whatever the case of A to Z);
several on one field must all hold, and a field or an operator left `undefined` is no
condition, so an optional filter needs no `if` (`productId` above may be undefined).
`page` takes `{ newestFirst: true }` for the newest first, the cursor going back.
Groups nest: `and` (every one), `or`
(at least one). `find` and `first` take `{ orderBy, limit }` too
(`{ orderBy: [{ field: 'position' }] }`), and go by id otherwise. Criteria are combined
with `allOf(a, b)`.

```ts
// packages/newt/core/criteria/criteria.ts (its documentation)
{ workspaceId, archived: false, or: [{ priceCents: { lt: 500 } }, { brandId: 'acme' }] }
```

Every store answers them as SQL would ([Stores](./stores#tables-and-criteria) says
how). The table's options (`types`, `unique`) are said in the same words to every
store, so the repository moves between stores unchanged. A row whose shape is not the
entity's DTO says how in `toRow` and `toChanges`.

**Filters a client sends** are not criteria: criteria are for the module's code, and
open; a client's filter is part of the public contract, and closed. `defineFilter`
declares what a client may filter by, each field with its operators, and the limits
(3 groups deep and 20 conditions by default; an `in` lists at most 100 values):

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardFilter = defineFilter({
  board: { field: 'boardId', value: z.string(), ops: ['eq', 'in'] },
  column: { field: 'columnId', value: z.string(), ops: ['eq', 'in'] },
  assignee: { field: 'assigneeId', value: z.string(), ops: ['eq', 'in'] },
  number: { field: 'number', value: z.number().int(), ops: ['eq'] },
}, { maxDepth: 2, maxConditions: 10 })

export type CardFilterDTO = z.infer<typeof CardFilter.schema>
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
  const { text, filter } = CardSearchSchema.parse(input)
  const criteria = filter ? CardFilter.toCriteria<CardRow>(filter) : {}
  const found = await this.repo.search(criteria, text, page)
  // …
}
```

A field or operator not declared is a 400; what the system imposes goes beside the
client's filter, in an `and` (`allOf`, or a `where` beside the criteria), where it
cannot be escaped. In cooper the workspace is imposed by the search's own
`where('workspaceId', '=', currentWorkspaceId())`, and the client's criteria join it
through `criteriaTree`, which turns criteria into a tree (`all`, `any`, `field`) a
query builder can translate. Every operator offered is a query
anyone can run: an `or` across fields keeps a database from using its indexes, so
offer what the data can answer quickly. A filter tree travels in a body
(`POST /api/workspaces/:workspaceId/cards/search`), not a URL.

**Queries a table cannot say** (a sum, a join, a report, a search in text) go through
the store's own API. Kysely on the store's connection is the recommended way
(`newt/kysely`): the same query runs on SQLite, Postgres or MySQL (though a write's
counts are `0n` on the servers), field names are the rows' (`workspaceId`), and it
joins the transaction in progress.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
async countByBoard(): Promise<CardCountByBoard[]> {
  const rows = await this.base.db
    .selectFrom('card')
    .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
    .where('workspaceId', '=', currentWorkspaceId())
    .groupBy('boardId')
    .orderBy('boardId')
    .execute()
  return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
}
```

A `COUNT` comes back as text on Postgres: `Number(…)` makes it work on all three.

**Keep repositories portable**: `TableRepository` by default, Kysely for what it
cannot say, and SQL of one store only when there is no other way (SQLite's full-text
search, say), kept in one place and flagged. Never fetch ids to send them back in an
`in`: a query takes a limited number of parameters (250,000 on SQLite in Bun), and one
query with everything in it does not. cooper's card search is one Kysely query, page
and total included. Then moving to another store is a new
store and its migrations, not new repositories.

**References between modules** (a card's column, its assignee) are ids only, as Vaughn
Vernon's aggregates: never the other entity, never a join to its table.

- On write, the use case checks a reference exists by asking its module (a read).
  `this.resolveRefs(ids, finders)` gives a `ReferenceNotFound` (400) for one that
  points nowhere; `null` is "none", and a key left out stays out. A finder is anything
  with `find({ id: [...] })` that gives `{ id, name }`:

  ```ts
  // cooper/backend/contexts/auth/modules/access/access.module.ts
  await this.resolveRefs({ productId }, { productId: this.deps.product })
  ```

  A check that needs more than existing asks its own question (cooper's card asks
  `member.isMember(assigneeId)` and answers `AssigneeNotMember`, a 400).
- When the referenced thing goes, the module that points at it follows its event, from
  a worker: a `handler` on `column.removed` calling `card.leaveRemovedColumn`, which
  finds the cards still in it when it runs.
- Showing names, not ids, is the client's composition (it asks both modules), or a
  read model a worker keeps from the events.
- A reference may point at something deleted for a moment, between the check and the
  save, or before the worker runs: that is accepted, and the worker clears it.

**`Repository`, for anything else**: entities spread over several tables, a query a
criterion cannot say, a store's own API. It gives `save`, and the repository writes
each entity its own way (`TableRepository` is one written this way):

```ts
// packages/newt/repository/table-repository.ts
async persist(...entities: E[]): Promise<void> {
  await this.save(entities, entity => this.write(entity))
}
```

### Saving

A transaction is one save, `repo.persist(...entities)`, never a whole use case.

- `persist` saves one or more instances **of its module's entity** at once, all or
  none, with the events they tracked: the jobs of those events are written in the same
  transaction, and their `fire-and-forget` handlers run after it commits.
- It writes only what changed, and only if each stored entity is still the version it
  was read as: otherwise it throws `ConcurrencyConflict` (409) and writes nothing. A
  new one that collides with a key or a unique value throws it too.
- **A use case runs again on a `ConcurrencyConflict`**, up to three more times,
  reloading and applying the change to what is stored now: a use case loads, changes
  and saves, and what cannot be undone leaves from a worker. Only the first use case of
  a chain runs again, with all it calls; one called by another lets the conflict
  through to it. One that does something before saving that must not happen twice (a
  call to another context that already saved) says `@UseCase({ retryOnConflict: false
  })`, with the reason beside it: then nothing in its chain runs again, not even its
  callers.

  ```ts
  // cooper/backend/contexts/auth/modules/token/token.module.ts
  /**
   * A client trades its code for tokens. It writes to `oauthGrant` without being a
   * worker, on purpose: the client waits for its tokens in this answer. The code is
   * spent first, then the tokens saved; should that fail, the client signs the person
   * in again. It never runs again on a conflict: the code it spent would look copied.
   */
  @UseCase({ writesTo: ['oauthGrant'], retryOnConflict: false })
  async exchange(input: TokenExchangeDTO): Promise<TokenPairDTO> {
  ```
- **A rule over several rows** (a board name unique in its workspace, a workspace with
  one admin) is not protected by a version: `save`'s `after` hook checks it, in the
  same transaction, after the writes; throwing rolls it all back. The save names what
  the rule guards, so no other save guarding the same thing runs in between, in any
  store:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.repository.ts
  async persistWithNameFree(board: Board): Promise<void> {
    const { workspaceId, name } = board
    await this.save([board], each => this.write(each), {
      guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
      },
    })
  }
  ```

  On Postgres and MySQL, saves of other keys never wait (on SQLite and files every
  save takes its turn anyway). A save with `after` must name its `guard`, or it does
  not compile: `guard: []` says, where it is read, that none is needed. `before`
  writes, or reads, what must go first (cooper's new card takes its number there). The
  use case still checks first, for a clear answer in the usual case.
- A write that only notes something happened (`lastUsedAt`) is not a change of the
  entity: the repository writes it with `table.patch(id, changes)`, which leaves the
  version alone, so parallel requests never collide.
- Rows that are no entity's (a projection, a search index, a link table rewritten
  whole, a purge) are written with `saveRows(write, { guard })`: in one transaction,
  under the write rule, guarding what it names. A repository writes through `save` or
  `saveRows`, never in a transaction of its own; `table.patch`, above, is the one
  exception.

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.repository.ts
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.base.db.deleteFrom('board').where('workspaceId', '=', workspaceId).execute()
    })
  }
  ```
- **A value many change at once (a stock, a balance, a counter) is not a field read
  and saved freely**: every change would collide with the others. Either it is what
  rows only ever inserted add up to (a module of movements), or every change takes it
  inside the save, in `before`, under a guard, so they take turns instead of
  colliding. cooper's card numbers are the second: each board keeps the last number it
  gave in a `card_counter` row, which a new card takes one up in the save of the card,
  under `boardCards:<board>`; it is never lowered, so a deleted card's number is not
  given again.

## Use cases

- Every public method of a module is a use case, marked `@UseCase()`. It is named
  after its module and itself (`list` of `board` is `board.list`), and each call is an
  invocation: a span of the trace, inside its caller's when another use case calls it.
  It holds no transaction: each `persist` is one.
- Validate the input at the door: `<M>CreateSchema.parse(input)`.
- Shape: validate → load → decide → change the entity → `persist` → return DTOs. Save
  once, at the end. When a use case cannot avoid saving in steps (or calling another
  context), put first what may fail, and make every step safe to run again.

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  @UseCase()
  async update(id: string, input: BoardUpdateDTO): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
  ```
- **No list is returned whole unless a rule of the domain bounds it** (at most 10
  columns, `MAX_COLUMNS`; 500 cards, `MAX_CARDS`); every other list goes by pages. A
  use case that lists takes a `PageRequest` (`size`,
  `cursor`) and returns a `Page` (`items`, `hasMore`, `total`). The cursor is the id
  of the last item shown: ids are v7, so they sort by time. `TableRepository.page`
  does all of it; routes read the page with `pageRequestFrom(request)` (`?size` from 1
  to 100, 20 by default, and `?cursor`). The page of entities becomes a page of DTOs
  written out, so it reads as what it is:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  const found = await this.repo.page({}, page, { newestFirst: true })
  return {
    items: found.items.map(board => board.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
  ```

  A list bounded by the domain may come whole, and says why (a board's columns, at
  most ten).
- **A flow over several modules can fail halfway**, since each step is its own
  transaction. It converges because every step is idempotent and a worker's job runs
  again until it completes. When a flow may be stopped by another path, each step done
  has its **compensation**, a step that undoes it, run from a worker on the event that
  stops the flow: a saga. (cooper's workspace deletion converges this way:
  `tenant.delete` takes the workspace's accesses away itself, right after saving the
  deletion, so nobody enters it from the moment it answers; `tenant.deleted` then sets
  going `tenant.removeAccesses` in auth, in case that second save failed (boards'
  membership also asks whether the tenant is still there, so nobody enters
  meanwhile), and
  `workspace.purge` and `activity.purgeWorkspace` in boards, each a job that runs until
  it completes.) A job that runs out of attempts is
  a flow stuck halfway: someone must look at it, fix the cause and put it back with
  `store.outbox.retry(id)`. cooper gives each context a small `Outbox_Module`
  (`shared/outbox`) whose use cases `dead(page)` and `retry(id)` list and retry its
  dead jobs, and its backoffice shows them to the staff, every context's through that
  context's own use cases.
- To turn a `find` into one item or an error, use `this.resolve(find, onMissing)` from
  `Module`: the caller picks the error (404 when the id is the resource, 400 when it is
  a reference inside the input).

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }
  ```

  `this.resolveRefs` turns the ids of an input into named references, or a
  `ReferenceNotFound`.
- **What only its owner may do takes the actor, not an id**: `tenant.create` makes the
  signed-in person its admin with `currentActor().userId`; no client sends who it is.

## Events

- Name: `<module>.<verb in past tense>` (`card.assigned`), class `<M>_<Verb>`
  (`Card_Assigned`, with a static `eventName`), file `events/<m>-<verb>.ts`.

  ```ts
  // cooper/backend/contexts/boards/modules/board/events/board-updated.ts
  type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

  export class Board_Updated implements DomainEvent<BoardChange> {
    static readonly eventName = 'board.updated'
    readonly name = Board_Updated.eventName
    readonly occurredAt = new Date().toISOString()
    constructor(readonly payload: BoardChange) {}
  }
  ```
- Payloads: `created` and `deleted` carry the DTO; `updated` carries `{ dto, changes,
  previous }`: the whole DTO, the fields that changed, and what they were before. Each
  field's transition is `previous[field]` → `changes[field]`. An event of its own kind
  carries what its listeners need (`card.assigned`: `{ dto, previousAssigneeId }`). A
  payload is JSON (`DomainEvent<T extends Json>`), as a `handler` gets it back from its
  stored job: a date travels as its ISO string, and a payload is a `type`, not an
  `interface` (which TypeScript does not take as JSON).
- **An event is published after the commit of the save that tracked it.** A save that
  rolls back publishes nothing.
- Events come from entities, through their repository. Something that is not an
  entity's may publish one on `base.bus`, with the same guarantees: its jobs in the
  transaction in progress, its `fire-and-forget` handlers after the commit.
- Each module offers its events under `events`, made with `eventsOf`:

  ```ts
  // cooper/backend/contexts/boards/modules/board/board.module.ts
  this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  ```
- Reactions live in `<m>.workers.ts`, always the same way: the module that reacts
  subscribes to the other's event, `deps.<module>.events.<event>.subscribe(fn, opts)`,
  and `opts.strategy` says how. Each strategy is typed with what it takes:
  - **`'handler'`, durably**: a job is written in the outbox in the transaction of the
    change, so both are stored or neither is; a worker runs it after the commit, again
    with a backoff if it fails, until it runs out of attempts (5, or `attempts`). It
    names its `queue`, in full: `<module that reacts>.<use case>.on.<module that
    tells>.<event>`. The emitter refuses a queue that does not end with its own event.

    ```ts
    // cooper/backend/contexts/boards/modules/card/card.workers.ts
    cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), {
      strategy: 'handler',
      queue: 'card.notifyAssignee.on.card.assigned',
    })

    deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
      strategy: 'handler',
      queue: 'card.leaveRemovedColumn.on.column.removed',
    })

    deps.access.revoked.subscribe(async access => {
      if (access.productId === WORKSPACES_PRODUCT && access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
    }, {
      strategy: 'handler',
      queue: 'card.unassignMember.on.access.revoked',
    })
    ```

    The callback only calls one use case of the module that reacts, with what it takes
    from the event; a condition on the event (an access to a workspace, not to the
    backoffice) may decide whether it calls it at all, never business logic. Renaming
    the queue leaves the pending jobs under the old name; the worker checks at start
    and every minute after, and warns once about a queue with jobs that no worker has
    served for five minutes (a few minutes after a deploy, since the old process served
    it until then).
  - **`'fire-and-forget'`, in memory**: run after the commit, and lost if it fails or
    the process stops. For what may be lost: a cache, a log line, an email whose
    payload must never be stored. It takes no queue.

    ```ts
    // cooper/backend/contexts/boards/modules/activity/activity.workers.ts
    events.moved.subscribe(({ dto, previous, by, via }) => {
      options.log(`[boards] #${dto.number} "${dto.title}" moved from column ${previous.columnId} to ${dto.columnId} by ${by ?? 'cooper'}${via ? ` (${via})` : ''}`)
    }, { strategy: 'fire-and-forget' })
    ```

    The same event has a `handler` too, which records the move in the card's
    activity: what must last goes by the outbox, what may be lost does not.
- A handler runs with no actor, never the publisher's, and in no scope: `currentActor()`
  throws `NoActor` in it, so what it needs it reads from the event, or it sets one
  itself with `runAsActor` (or enters a scope, as cooper's workers do with
  `runInWorkspace`). It calls a use case of its own module, which is the only place it
  may write to another module (see [How modules talk](#how-modules-talk)). It may run
  more than once: it is idempotent.
- **What cannot be taken back leaves from a worker, never from a use case**: an email
  is sent after the event of what it is about, so only for what was saved (cooper's
  `card.notifyAssignee`, on `card.created` and `card.assigned`).
- **An event's shape only grows.** Its jobs keep it as it was published, and may run
  after a deploy with the code of then: an event only gains optional fields. A change
  that breaks its shape comes with a migration that rewrites its pending jobs.

## Errors and what they say

Domain errors live in the module's `errors/`, one class each, with a stable `code`
(`board.not_found`). They extend a base, which decides the HTTP status:

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-not-found.ts
export class BoardNotFound extends NotFoundError {
  readonly code = 'board.not_found'
  constructor(id: string) {
    super(`There is no board ${id}`)
  }
}
```

| Base | Status | When |
|---|---|---|
| `NotFoundError` | 404 | the requested resource itself does not exist |
| `ValidationError` | 400 | the input is wrong |
| `ReferenceNotFound` | 400 | an id **inside** the input points nowhere |
| `UnauthorizedError` | 401 | nobody is signed in, or the credentials are wrong |
| `ForbiddenError` | 403 | whoever asks may not do this |
| `ConflictError` | 409 | the current state does not allow it |
| `ConcurrencyConflict` | 409 | someone saved it since it was read |

All of them extend `DomainError` (`status`, `code`, `message`). A domain error is an
answer, not a failure: it does not mark its use case's span as failed.

The framework's own errors speak plain English, for a developer. An application
replaces their messages once, at startup, for the whole process: in its own words, or
in another language. Only the message changes; the `code` and the status stay. cooper
does it in `index.ts`, before it opens anything:

```ts
// cooper/backend/shared/messages.ts
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'You are not signed in, or your session has ended: sign in to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

// …
export function setCooperMessages(): void {
  setMessages(cooperMessages)
}
```

Being the whole process's, it is tested in a process of its own (cooper's
`messages.test.ts` runs it with `Bun.spawn`): set in a test, it would change what
every other test in that process reads.

Its codes are `concurrency_conflict`, `reference_not_found`, `not_signed_in`,
`invalid_email`, `invalid_secret_token`, `route_not_found`, `method_not_allowed`,
`validation`, `malformed_body`, `unsupported_media_type`, `filter_too_deep`,
`filter_too_many_conditions` and `internal`.

An OAuth endpoint answers in OAuth's format instead, `{ error, error_description }`:
`toOauthErrorResponse(error, fallback, codes)` from `newt/http` maps each domain error
code to an OAuth one.

## Value objects

A value with rules of its own (how it is written, compared or made) is a value object,
defined once: a type and a const with the same name.

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
export type BoardName = string & z.$brand<'BoardName'>

export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>
```

- **Its type is branded**: at runtime a `BoardName` is a string, but to the compiler a
  plain string is not a `BoardName` until it went through `BoardName.from` (what
  someone typed) or `BoardName.schema` (what was stored). A function that takes one
  cannot be handed an unchecked string by mistake.
- The framework has `Email` (trimmed and in lower case, up to 254 characters; an
  `InvalidEmail` is a 400) and `SecretToken` (32 random bytes in base64url, with
  `generate()` and `hash(token)`; an `InvalidSecretToken` is a 400). The entity's
  schema uses `X.schema`; an input schema stays lenient (a plain `z.email()`), and the
  entity or the use case runs it through `X.from` before keeping it.

  ```ts
  // cooper/backend/contexts/auth/modules/user/user.schema.ts
  export const UserSchema = z.object({
    id: z.uuidv7(),
    email: Email.schema,
    // …
  })

  export const UserSignUpSchema = z.object({
    email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
    // …
  })
  ```
- **Where values come back from storage, say their type there**: a row type says
  `email: Email` (and so does the table type Kysely is given). Nothing else needs a
  cast.
- A string from outside that must be one (a token from a cookie) is checked with
  `X.schema.safeParse(value)`, and its `data` is the value.

## Data

- **Ids are UUIDv7**, given by `Entity`. Never pass an id in a create input:
  pagination by id relies on v7 sorting by time.
- **Every entity's row has a `version`**, which saves check and move on.
- **Soft delete** (`softDelete: true`) keeps a deleted row with its `deletedAt`, and
  leaves it out of every find. A unique value should be unique among the rows not
  deleted: on SQLite, a partial unique index.

  ```sql
  -- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
  CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
  ```
- Do not design around the store: the entity and the use cases come first, the tables
  follow them.

## Analytics

Data meant to be read a lot at once (cards created per day, by workspace) goes to an
analytical database through the `Analytics` port (`newt/port-analytics`): only ever
appended to, never changed (`append(dataset, rows)`). It has no transactions, so it is
fed by `handler` workers after the events of what the store saved; each row carries an
id of its own (the event's, the card's), so a job that runs twice adds nothing.
Reading it is each adapter's own query language. No adapter comes with the framework
yet; `MemoryAnalytics` (in `newt/port-analytics/contract`) is the one for tests, and
`describeAnalyticsContract` checks a new one. cooper writes a small one on SQLite
(`shared/analytics/sqlite-analytics.ts`, in the backoffice's own database), declares
the reads it needs in an interface of its own, and feeds it from `handler` workers on
auth's and boards' events, each row by the id of what it counts:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
deps.card.events.created.subscribe(card => metrics.recordCard(card), {
  strategy: 'handler',
  queue: 'metric.recordCard.on.card.created',
})
```

## Observability

Each context may hand its `Base` a `Tracer` (`new BoardsBase({ name, store, tracer
})`): every use case call is a span, named after it, with the context, module and use
case as attributes, a child of its caller's, marked with the error when one that is
not a domain error escapes, and with an event (`conflict.retry`) for each retry on a
conflict. The job worker's own steps are spans too. Without a tracer, nothing is
recorded (`NoopTracer`).

Hand the **same** tracer to every context of a process. The active span travels with
the work, so a use case of one context called by another's lands inside its caller's
span: one trace for the whole request, across contexts. cooper makes one
`ConsoleTracer` (`shared/observability`) when `COOPER_TRACE=1` and gives it to all
three (see `open-contexts.ts` above); it writes each trace once it ends, and leaves the
worker's `job.…` spans out.
