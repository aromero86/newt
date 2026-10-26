# A context and its base

A **context** is a part of the application with its own data, its own modules and its
own server. cooper has three: `auth`, `boards` and `backoffice`. This chapter builds
what each one stands on: the base its modules receive, the context that opens them,
its settings, and the program that starts and stops them all.

## Why three, and not one

You could put accounts, boards and the staff's console in one context. They would
share one database and one server, and any module could read any table. It would work
for a while.

Then the pieces start to pull apart. Accounts and OAuth change rarely and must never
break; boards change every week. The staff's console reads everything, and must change
things only the way the apps themselves would. And every app that signs people in through `auth`
should do it the same way, from outside, as any other OAuth client would.

So cooper draws a line around each part:

- **Each context has its own store** (a SQLite file), its own modules and its own
  server, on its own port and, in production, its own domain.
- **Contexts depend on each other without cycles.** `auth` uses none; `boards` uses
  `auth`; `backoffice` uses both. Each one is opened after the ones it uses, and
  receives their modules.
- **A context reaches another only through its use cases and its events**, never
  through its store. `boards` asks `auth` "is Bob a member of Acme?" by calling a use
  case, never by reading `auth`'s tables.

The lint keeps the second rule (chapter [1](./01-the-project)). The types keep the
third: a context is never handed another context, only the modules it uses from it,
and those modules have use cases and events, never a store. Here is what `backoffice`
is given:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events (ch. 23).
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token' | 'outbox'>
  boards: Pick<Boards_Modules, 'board' | 'card' | 'outbox'>
}
```

A `Pick` of the other context's `modules`: `backoffice` can call `boards.card`'s use
cases, and has no way to `boards.base.store`, nor even to `boards.column`. What it
uses from each context is written in one place, and growing it is a decision you
see in a diff. Chapter [19](./19-several-contexts) is about how contexts talk.

## The base: what every module receives

Every module, when it is created, receives the **base** of its context. In it, it finds
everything it needs: the store where data is kept, the event bus, the queue of the
workers' jobs, and the invocations of its use cases.

newt gives you a `Base`. Your application extends it with whatever it wants to give its
modules. cooper gives them a router, where each module registers its routes:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the router its
 * context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

`Base<SqliteStore>` says that cooper's modules run on SQLite. A base can also be
`Base<Store>`, which says the modules work with **any** store: files, SQLite, Postgres,
MySQL. That is the better default while no module needs more. cooper does need more:
`boards` writes some queries with Kysely, which needs a SQL store. So its base says so:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { kyselyFor } from 'newt/kysely'
import { CooperBase } from '../../shared/cooper-base'
import type { BoardsDatabase } from './boards-database'

/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (counts by workspace, a search in the text of the
 * cards). Kysely needs a SQL store: `boards` opens on SQLite, and would open on
 * Postgres or MySQL the same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
```

Each context can extend the shared base with what only its modules need. `auth` adds a
second router for the OAuth endpoints, which live outside `/api`
(chapter [20](./20-oauth-server)).

## A context that serves itself

newt's `BoundedContext` is a name and a base, with `start()` and `stop()`. Every
context of cooper also serves itself on a port. That part is the same for the three,
so it lives in `shared/`:

```ts
// cooper/backend/shared/served-context.ts
import type { Server } from 'bun'
import { BoundedContext } from 'newt/runtime'
import { serve } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
    base.http.get('/health', () => Response.json({ status: 'ok', context: name }), { public: true })
  }

  /** What its server answers besides its modules' API: an MCP entry, a `/.well-known` document. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** Its server: its modules' API, what it adds, and its frontend for any other address. */
  serve(): Server<undefined> {
    return serve({ port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder })
  }
}
```

`serve` from `newt/http` turns the router into a `Bun.serve`: every route of the
router under `/api`, the extra `routes` beside them, and the built frontend for any
other address. `{ public: true }` lets a route answer without anyone signed in; every
other route needs an actor (chapter [5](./05-who-and-where)).

## The context

The context opens its store, creates the base, initializes the modules and knows how
to serve itself. Here is `boards`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Tracer } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_Auth, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'
import { mcpRoutes } from './mcp/mcp'

export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config, private readonly auth: Boards_Auth) {
    super('boards', base, config)
  }

  /** Opened after `auth`, which it uses; watched by `tracer`, if one is given (ch. 30). */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new BoardsBase({ name: 'boards', store, tracer })
    return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
  }

  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
```

What to notice:

- **`SqliteStore.open`** opens the database file (and creates it if it is not there),
  then applies the SQL migrations in `migrations/` that it has not applied yet. When
  `open` returns, the tables are up to date, before any module reads them. Chapter
  [24](./24-migrations) is about migrations.
- **`open` receives `deps`**: what `boards` needs from outside, `auth`'s use cases
  among them. Whoever opens the context hands them in. That is how a context gets the
  ones it uses without importing how they are opened.
- **`tracer`** is optional: when given, the base reports to it every use case it runs
  (more below).
- **`initializeModules`** creates the modules, each one after the modules it uses:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // Its people sign in through auth: boards is the OAuth client of the product `cooper`.
  const session = WebSession_Module.initialize(base, { /* … */ })
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  // …
  return { session, member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

The returned object is the context's `modules`: `boards.modules.board.create(…)` is how
a script, a test or another context calls a use case. You will add `board` to this
list at the end of the next chapter.

## Its settings

A context needs to know where to listen, where its database is and where people open
it. cooper reads all of it from environment variables in one file, with what
development needs by default:

```ts
// cooper/backend/config.ts
const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env
// …
export const config = {
  // …
  /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DB_PATH`: its database file. */
    dbPath: fromRoot(env.COOPER_BOARDS_DB_PATH ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
    /** Where its people sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: boards is the product `cooper` in auth. */
    clientSecret: clientSecrets.cooper,
    sessionDays,
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
  // … auth and backoffice, the same way
}

export type Config = typeof config
```

Each context takes its own part, and nothing else:

```ts
// cooper/backend/contexts/boards/boards-config.ts
import type { Config } from '../../config'

/** The settings of `boards`, from `config.ts`. */
export type Boards_Config = Config['boards']
```

Bun loads `.env` on its own, so a `.env` file at the root is enough to change any of
them on your machine. A context never reads `process.env` itself: it receives its
config. That is what lets a test open it with `dbPath: ':memory:'` and `port: 0`.

## Opening them all, in order

`open-contexts.ts` opens the three, each one after those it uses, and hands each the
ones it needs:

```ts
// cooper/backend/open-contexts.ts
/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  // One tracer for every context: a use case that calls another context's shows that
  // call inside it, since they run in one process (ch. 30).
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

`boardsOnAuth(auth)` turns `auth`'s use cases and events into what `boards` asks for,
in `boards`' own words ("is this person a member of this workspace?"). Chapter
[19](./19-several-contexts) shows it whole. `backoffice` gets `auth.modules` and
`boards.modules`, typed as the `Pick`s it declared: its code reaches only what it
picked. For now, see the
order: `auth` is opened first because `boards` needs it to open, and it is stopped last
for the same reason.

The tracer is one for all three. With `COOPER_TRACE=1`, every use case any context
runs is written to the console when it ends, with the use cases it called inside it,
and how long each took. The contexts run in one process, so when a `boards` use case
calls `auth`'s, the second shows inside the first: one tracer per context would cut
that trace in two. Chapter [22](./22-backoffice) shows what it writes.

## Start and stop

The program is short. It opens the contexts, serves each on its port, starts their
workers, and stops cleanly on a signal:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running.
import { config } from './config'
import { openContexts, stopContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

const servers = contexts.all.map(context => {
  const server = context.serve()
  console.log(`${context.name} listening on ${server.url}`)
  return server
})
for (const context of contexts.all) context.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
    process.exit(0)
  })
}
```

- **Before anything**, `setCooperMessages()` gives newt's own error messages the
  words cooper wants them in. Chapter [3](./03-first-module) shows it.
- **On start**, each context opens (and migrates) its store, serves, and
  `context.start()` starts the loop that runs its workers, in this same process.
- **On stop** (`SIGINT`, `SIGTERM`), the servers stop accepting requests first. Then
  `context.stop()` waits for the workers that are running and closes the store. A
  restart never cuts a job in half; what was still pending stays pending, and runs
  when the process comes back.

The framework also warns when jobs wait in a queue no worker has served for five
minutes: almost always a use case or a module that was renamed (chapter
[11](./11-reacting)).

## Why SQLite

A context keeps its data in a **store**. newt has four, and a module that only uses
tables and criteria runs on any of them:

| | Files | SQLite | Postgres and MySQL |
|---|---|---|---|
| **What it is** | A JSON file per record, in folders. | A SQLite database, in one file. | A database server. |
| **Install** | Nothing. | Nothing (it comes with Bun). | The server; the driver comes with Bun. |
| **Size** | Thousands of records. | Millions. | Millions, and several machines. |
| **Transactions** | One at a time. | One at a time. | Many at once. |
| **Structure** | None: each table is a folder. | SQL migrations. | SQL migrations, in their dialect. |

cooper uses SQLite: nothing to install, real SQL (which Kysely and the migrations need),
and enough for production on one machine. Each context has its own file:
`data/cooper-auth.db`, `data/cooper-boards.db`, `data/cooper-backoffice.db`.

For tests, `:memory:` opens a database that lives only until it is closed, and behaves
exactly like one on disk. Chapter [26](./26-production) shows what changes on Postgres
or MySQL.

## Check it

Start the backend alone and ask `boards` if it is up:

```bash
bun cooper/backend/index.ts
```

```
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

```bash
curl -s localhost:3002/api/health
```

```json
{"status":"ok","context":"boards"}
```

Any other route of the API needs someone signed in:

```bash
curl -s localhost:3002/api/workspaces/x/boards
```

```json
{"error":"Your session has ended: sign in again to go on","code":"not_signed_in"}
```

cooper's own test does the same with the three contexts, every database in memory and
every server on a free port:

```ts
// cooper/backend/open-contexts.test.ts
/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: 0 },
    boards: { ...config.boards, dbPath: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0 },
  }
}

test('opens the three contexts, serves each on its own port, and stops them', async () => {
  const mails: Mail[] = []
  const contexts = await openContexts(testConfig(), { mailer: { send: async mail => { mails.push(mail) } } })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards', 'backoffice'])

  const servers = contexts.all.map(context => context.serve())
  for (const context of contexts.all) context.start()
  try {
    expect(new Set(servers.map(server => server.port)).size).toBe(3)
    for (const [index, context] of contexts.all.entries()) {
      const response = await fetch(new URL('/api/health', servers[index]!.url))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok', context: context.name })
    }
    // …
  } finally {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
  }
  // …
})
```

## In short

- A context has its own store, modules and server. Contexts depend on each other
  without cycles, and reach each other only through use cases and events: hand a
  context a `Pick` of the other's `modules`, never the context.
- The base is what every module receives. Extend newt's `Base` with what your modules
  need (a router, Kysely), and type it with the store they really need: `Base<Store>`
  if any will do.
- The context opens its store (which migrates it), creates the base and initializes
  its modules, each after the ones it uses. It receives its config and the contexts it
  uses; it never reads the environment.
- Open contexts in dependency order, stop them in reverse. On a signal: stop the
  servers, then `context.stop()`, which waits for the workers.
