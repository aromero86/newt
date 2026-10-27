# Shipping it

One piece of code is left, and it is about stopping. When a deploy tells cooper to
stop, each server should go on answering for a moment, saying it is stopping, so that
whoever balances the load in front of it sends it nothing new before it closes. That
is a setting and one line, below, in [Starting and stopping](#starting-and-stopping).
With it, your tree is cooper: the same contexts, modules, migrations, tests and
scripts as the repository's `cooper/`. The last checkpoint, `tutorial/29`, is the
repository's code, and

```sh
git diff tutorial/29 main -- cooper eslint.config.js 'tsconfig*.json' package.json bun.lock
```

prints nothing.

The rest of this chapter is about putting it in front of people: the end-to-end test
that says cooper works as a whole, the build, the settings, how it starts and stops,
the lint as a checklist, and the rules the guide taught, in one place.

## cooper, end to end

Every chapter added its tests beside its code: a module's use cases, a context over
HTTP, a port's contract. One file tests cooper as a whole, as people use it:
`cooper/backend/cooper.test.ts`. It opens the three contexts as the server opens them
(`openContexts`, SQLite in memory), serves auth and boards on free ports, and drives
them over HTTP with `newt/testing`'s `browser()` (chapter
[22](./22-web-session)), as boards' UI would:

- **`signUp`** goes through the real sign-in: boards' `/api/session/sign-in`, auth's
  sign-up and consent, back to boards' callback with a session cookie.
- **Workspaces, through boards**: a new workspace gets its welcome board a moment
  later (auth's event, boards' worker, chapter [20](./20-wiring-contexts)); an
  invitation is accepted by who has its email, read from the mail the worker sent
  (chapter [19](./19-invitations-and-time)); someone removed leaves their cards
  unassigned; a deleted workspace loses its boards, and nobody enters it (chapter
  [14](./14-sagas)).
- **The MCP server**: a client connected through OAuth works with its person's boards,
  and a request without a token is refused with where to get one (chapter
  [24](./24-mcp-server)).

"A moment later" is `settled()`: auth's jobs, then boards', run until idle, in the
order the work flows.

```sh
bun test cooper/backend/cooper.test.ts
```

```text
 6 pass
 0 fail
 80 expect() calls
Ran 6 tests across 1 file.
```

And the whole gate, once more:

```sh
bun install && bun check && bun test cooper && bun run lint && bun run cooper:build
```

```text
 170 pass
 0 fail
 623 expect() calls
Ran 170 tests across 29 files.
```

With `COOPER_TEST_POSTGRES_URL` set (chapter [27](./27-postgres)), five more run on
Postgres.

## Building the frontends

In development, `bun run cooper` starts the backend and one Vite server per frontend,
which sends the API's addresses on to its context (chapter [23](./23-frontends)). In
production there is no Vite. Build the three apps once:

```sh
bun run cooper:build
```

Each lands in `dist/cooper/<name>`: `auth`, `boards`, `backoffice`. Each context
serves its own, on its own port, for every address its routes do not take:

```ts
// cooper/backend/shared/served-context.ts
  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds, its health, and its frontend for any other address. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, health: true }
  }
```

newt's `serve` answers a path that names a file in the folder with that file, and any
other with `index.html`, so the app's router shows its page (or its own "not found").
Every HTML page refuses to be framed (`X-Frame-Options: DENY`), so no other site can
hide auth's consent page in a frame and steal the click. A folder without
`index.html` answers `503 The frontend is not built`, and the API works all the same.

```sh
bun cooper/backend/index.ts
curl -s -i localhost:3002/ | head -3
```

```text
HTTP/1.1 200 OK
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
```

## The settings

Everything comes from environment variables, read once in `cooper/backend/config.ts`,
with what development needs by default. Bun loads a `.env` file on its own.

| Variable | Default | What it is |
|---|---|---|
| `COOPER_AUTH_PORT` | `3001` | Where auth listens. |
| `COOPER_BOARDS_PORT` | `3002` | Where boards listens. |
| `COOPER_BACKOFFICE_PORT` | `3003` | Where the backoffice listens. |
| `COOPER_AUTH_DATABASE` | `data/cooper-auth.db` | auth's database: a SQLite file, or a `postgres://` address. |
| `COOPER_BOARDS_DATABASE` | `data/cooper-boards.db` | boards' database, the same way. |
| `COOPER_BACKOFFICE_DATABASE` | `data/cooper-backoffice.db` | The backoffice's database, the same way. |
| `COOPER_AUTH_PUBLIC_URL` | `http://localhost:5171` | Where people open auth. |
| `COOPER_BOARDS_PUBLIC_URL` | `http://localhost:5172` | Where people open boards. |
| `COOPER_BACKOFFICE_PUBLIC_URL` | `http://localhost:5173` | Where people open the backoffice. |
| `COOPER_BOARDS_CLIENT_SECRET` | a development secret | boards' OAuth client secret. |
| `COOPER_BACKOFFICE_CLIENT_SECRET` | a development secret | The backoffice's OAuth client secret. |
| `COOPER_AUTH_FRONTEND` | `dist/cooper/auth` | auth's built frontend. |
| `COOPER_BOARDS_FRONTEND` | `dist/cooper/boards` | boards' built frontend. |
| `COOPER_BACKOFFICE_FRONTEND` | `dist/cooper/backoffice` | The backoffice's built frontend. |
| `COOPER_SESSION_DAYS` | `30` | How long a browser session lasts, in every context. |
| `COOPER_INVITATION_DAYS` | `7` | How long an invitation waits to be accepted. |
| `COOPER_OAUTH_ACCESS_MINUTES` | `60` | How long an access token lasts. |
| `COOPER_OAUTH_REFRESH_DAYS` | `30` | How long an unused refresh token lasts. |
| `COOPER_MAIL_FROM` | `cooper <no-reply@cooper.local>` | Who the emails come from. |
| `COOPER_TRACE` | off | `1` writes every trace to the console, and each card's move. |
| `COOPER_OTLP_URL` | none | An OpenTelemetry collector the traces go to instead. |
| `COOPER_DRAIN_MS` | `2000` | How long each server goes on answering once told to stop. |

Relative paths are relative to the repository's root. The tests read one more,
`COOPER_TEST_POSTGRES_URL`, and nothing else does.

In development the public URLs are the Vite servers. In production each is the
context's own domain, in front of its port: `auth.example.com` to 3001, and so on.
The public URLs are what auth puts in its OAuth metadata and its redirect URIs, and
what the tokens are for (chapter [24](./24-mcp-server)), so they must be the addresses
people really open. Each context on its own domain also keeps its cookies to itself
(chapter [22](./22-web-session)).

::: warning
The client secrets have development defaults so that cooper runs with no setup. In
production, set both: with the defaults, anyone who read this guide could act as
boards at auth's token endpoint.
:::

The mailer is the one dependency that is not a variable: `openContexts` takes it as
an option and uses the `ConsoleMailer` when none is given (chapter
[12](./12-failures)). A real one, SMTP or an email API, is any object with the same
`send(mail)`.

## Starting and stopping

The backend is one process, `bun cooper/backend/index.ts`. Its last setting is how
long a server drains as it stops. Add it to `config.ts`, after `trace`:

```ts
// cooper/backend/config.ts
// …
  trace: env.COOPER_TRACE === '1',
  /**
   * `COOPER_DRAIN_MS`: how long each server goes on answering once told to stop, its
   * health a 503 meanwhile, so whoever balances the load sends it nothing new: 2
   * seconds. Only the backend's process drains: a test stops its servers at once.
   */
  drainMs: Number(env.COOPER_DRAIN_MS ?? 2000),
// …
```

and serve each context with it, in `index.ts`:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { cooperTracer, openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
// Stopping, each server's health answers 503 for a moment before it closes.
const app = runContexts(contexts.all.map(context => ({ context, serve: { ...context.serving(), drainMs: config.drainMs } })), { tracer: cooperTracer(config) })
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

**Before it starts**, apply the migrations on their own, with the new version's code
and the production settings (chapter [27](./27-postgres)):

```sh
bun run cooper:migrations status
bun run cooper:migrations up
```

The server would apply them as it opens each context anyway. Doing it first makes a
failing migration fail in a command you are watching, not in the start of three
servers.

**Starting**: cooper's messages are set; the contexts open in order (auth, boards,
backoffice), each one's store brought up to date; `runContexts` sets the tracer,
serves each context, then starts each one's worker.

**Health**: each context answers `GET /api/health` without a session (chapter
[1](./01-project-and-context)): `200 {"status":"ok"}` while it serves. Point your load
balancer or orchestrator at it, one check per context.

**Stopping**, on SIGINT or SIGTERM (what a deploy sends):

1. Every server drains, then stops taking requests. Its health answers
   `503 {"status":"stopping"}` from that moment. For `drainMs` it goes on answering
   everything else as before, so a load balancer that polls the health sees the 503
   and moves new requests to another instance while this one still answers the ones
   already on their way. Then it closes, and the requests in progress finish.
2. Each context stops, the last opened first, so none stops before one that uses it:
   its worker stops claiming jobs, waits for the ones in progress, and its store
   closes.
3. The tracer sends what it still keeps (`flush`).

`serving()` gives no `drainMs`, so the tests, which open contexts and serve them the
same way, stop their servers at once; only `index.ts` adds it. Try it with a longer
drain:

```sh
COOPER_DRAIN_MS=3000 bun cooper/backend/index.ts
```

From another terminal, send it SIGTERM (`kill -TERM <its pid>`) and ask for its
health within those three seconds:

```sh
curl -s -i localhost:3002/api/health
```

```text
HTTP/1.1 503 Service Unavailable
…
{"status":"stopping"}
```

Three seconds later the servers are closed, and the same `curl` finds nobody.

What was pending stays pending, in the outbox, and runs when cooper comes back: a job
is written in the same transaction as the change that made it (chapter
[11](./11-reacting)), so nothing is lost between the two.

After a deploy, watch the logs for `[JobQueue] N job(s) of '…' wait, and no worker
serves that queue: was its handler renamed or removed?`. It almost always means a handler, a use case or a module was
renamed, and the old jobs wait under the old name (chapter [11](./11-reacting)). Jobs
that failed for good are listed, and run again, in the backoffice (chapter
[26](./26-dead-jobs-and-analytics)).

### One process, for now

cooper as it is runs as **one** process. The databases would take more: SQLite takes
writers from several processes in turn, Postgres side by side, and the outbox hands
each job to one worker whichever process it is in. What does not is boards' card
search: `MemoryCardSearch` lives in the process's memory (chapter
[16](./16-search-port)). With two processes, each would index only the cards whose
jobs its own worker ran. Before running boards twice, give the search port an
adapter outside the process (Elasticsearch, Postgres' full text), checked by the same
`describeCardSearchContract`. Nothing else changes: that is what the port was for.

## The lint, as a checklist

`bun run lint` holds every module to the same shape and every context inside its
borders. Before a change goes in, it checks what you would otherwise check by eye:

- [ ] **`newt/module-anatomy`**: the module has the files every module has, named
  after it (`<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`,
  `<m>.routes.ts`, `<m>.workers.ts`…), and its events are `<m>-<event>.ts`
  (chapter [2](./02-first-module)).
- [ ] **`newt/module-boundaries`**: a module imports from another only its module,
  schema, events, errors and value objects; never its entity, repository, routes or
  workers.
- [ ] **`newt/schema-imports`**: a module's `<m>.schema.ts` takes from newt only
  `newt/contract`, because a frontend imports it (chapter [23](./23-frontends)).
- [ ] **`newt/use-case`**: every public method of a module is a `@UseCase`, or
  `private` (chapter [2](./02-first-module)).
- [ ] **`newt/route-body`**: a route passes the body to its use case as it came,
  `await request.json()`, never `as` a DTO; the use case takes `unknown` and parses it
  (chapter [2](./02-first-module)).
- [ ] **`newt/queue-name`**: a handler's queue is
  `<module>.<use case>.on.<module>.<event>`, and its callback calls that use case
  (chapter [11](./11-reacting)).
- [ ] **`newt/context-boundaries`**: a context imports only those its `uses` names:
  auth none, boards auth, the backoffice both (chapter [20](./20-wiring-contexts)).
- [ ] **No `transaction` in a module**: a module writes through its repository's
  `save` or `saveRows` (chapter [6](./06-rules-over-rows)).
- [ ] **No promise left unawaited** (`@typescript-eslint/no-floating-promises`).
- [ ] **The frontends**: no class names or inline styles outside `@cooper/ui` and an
  app's `components/`, and never an import of the backend but a module's
  `*.schema.ts`, from `@cooper/api` (chapter [23](./23-frontends)).

What the lint cannot see, newt checks as it runs: a save that reads rows and guards
nothing (the guard rule), a write into another module outside a worker, or two
modules saved in one transaction, in a worker too (the write rule, unless `writesTo`
says so), a queue whose name does not match its subscription.
And the compiler: a save with `after` and no `guard` does not compile, nor a
repository that does not state its scope.

One more item is not code: **`cooper/AGENTS.md`** is up to date. A coding agent reads
it before anything else (chapter [1](./01-project-and-context)), and it should name
every context, what each uses, and cooper's own conventions, as the chapters added
them (4, 17, 20, 25). Yours now matches the repository's:

````md
# AGENTS.md

Before writing code, read ../node_modules/newt/AGENTS.md: it is the rules of the
framework, versioned with it. What follows is this project's own.

## This project

cooper: boards of cards for teams, each team in a workspace of its own. newt's
example application, built step by step in its tutorial (web/guide).

## Contexts

In backend/contexts/, each with a database of its own. Which contexts each one uses
is said in the root's eslint.config.js, and the lint keeps it.

- boards: the boards of each workspace, their columns and cards. Uses auth.
- auth: people, the workspaces (its tenants) and who may enter each, and how people
  sign in. Uses none.
- backoffice: what the staff see and do across the others. Uses auth and boards.

## Conventions

- Every context's base is a `CooperBase` (shared/cooper-base.ts); a module registers
  its routes on `base.http`, in its `<m>.routes.ts`.
- boards' repositories are scoped by workspace (contexts/boards/workspace-scope.ts).
- auth's repositories say `scope: 'none'`: people, sessions and tenants span
  workspaces, so its use cases ask who may see what.

## Commands

From the repository's root:

```sh
bun check          # types
bun test cooper    # cooper's tests
bun run lint       # newt's lint (eslint.config.js)
```
````

## See it whole

cooper has grown to three contexts, 25 modules and 145 use cases. The last line of this
chapter's `package.json` draws them:

```json
    "cooper:graph": "newt-graph --root cooper/backend"
```

```sh
bun run cooper:graph
```

newt-graph reads cooper's code and opens a page at `http://localhost:4747` with its
contexts, modules, use cases and events. Pick `card.create` and press `e`: you watch the
card's history, its index, the mail to the assignee and the backoffice's metric run one
after the other, each on the worker that runs it, as chapters 11 to 26 built them.
[Appendix G](./g-command-line) has its keys and its limits; [appendix H](./h-describe-application),
what cooper says of itself while it runs, with the same ids.

## The rules, once more

What the chapters taught, in the order you met it. Appendix
[A](./a-golden-rules) has the same rules on one page.

**A module.**

- One module, one responsibility, and always the same files (chapter
  [2](./02-first-module)).
- The schema is the contract: inputs have only what a client sends; a value object
  keeps a value's rules in one place (chapter [2](./02-first-module)).
- Only the entity changes itself; only the repository touches the store; a route does
  not think (chapter [2](./02-first-module)).
- A route passes the body as it came; the use case takes it as `unknown` and parses
  it. Every public method of a module is a use case (chapter [2](./02-first-module)).
- A route never catches: what a use case throws becomes `{ error, code }` with its
  status, and a client acts on `code` (chapter [3](./03-pages-and-errors)).
- No list is returned whole unless a rule of the domain bounds it; every other goes
  by pages (chapter [3](./03-pages-and-errors)).
- Who is the actor, never an id passed by hand; may they is asked every time; where
  is a scope, which every repository states, `'none'` included (chapter
  [4](./04-who-and-where)).

**Data and its rules.**

- The store is a port; the context picks it, the modules never know (chapters
  [5](./05-sqlite) and [27](./27-postgres)).
- An applied migration never changes; a change is a new one, in every dialect
  (chapters [5](./05-sqlite), [18](./18-tenants-and-access) and [27](./27-postgres)).
- A version protects one row; a rule over several rows is checked in the save's
  `after`, under a `guard` as narrow as the rule (chapter [6](./06-rules-over-rows)).
- A value everyone changes at once lives in a row of its own, taken in `before` under
  a guard; a unique index has the last word (chapter [7](./07-cards-and-a-counter)).
- A conflict runs the use case again, from the start (chapter
  [8](./08-two-people-one-card)).
- A POST that creates is made safe to send twice with an `Idempotency-Key` (chapter
  [9](./09-idempotent-posts)).
- What a table cannot say is Kysely, and Kysely does not know the scope: write the
  workspace's `where` yourself (chapter [15](./15-kysely)).
- Time is a dependency: ask `now()`, and a test controls the clock (chapter
  [19](./19-invitations-and-time)).
- Keep a hash, never the secret (chapter [17](./17-auth)).

**Events and workers.**

- An event is something that happened, noted by the entity and published once the
  save commits (chapter [10](./10-events)).
- A reaction is a job in the outbox, written in the same transaction; it runs at
  least once, so it must not matter if it runs twice (chapter [11](./11-reacting)).
- What cannot be undone leaves from a worker, which reads again before acting, and
  with a key of its job's event, so that sent twice it goes once (chapter
  [12](./12-failures)).
- A module that follows another reacts to its own events too: each follower runs
  after its own commit and checks the other side, so whichever runs last sees both
  (chapter [13](./13-another-context)).
- A use case writes into another module only from a worker; the exception says so
  with `writesTo` (chapters [8](./08-two-people-one-card) and
  [17](./17-auth)).
- Work over several modules is a saga of steps that each find what an earlier run did
  (chapter [14](./14-sagas)).
- A projection is a moment behind; read the real rows after it (chapter
  [16](./16-search-port)).

**Contexts.**

- A context is its own database, modules and migrations; what it needs from another
  is a port in its own words (chapters [13](./13-another-context) and
  [17](./17-auth)).
- Writes into another context start at an entry point, never in a use case of yours
  (chapter [20](./20-wiring-contexts)).
- A third context reads the others only through their use cases (chapter
  [25](./25-backoffice)).

**Doors.**

- Addresses with a format of their own get a router of their own, and their own
  `onError` (chapters [21](./21-oauth-server) and [24](./24-mcp-server)).
- The browser holds only its context's session cookie; the server does the OAuth
  (chapter [22](./22-web-session)).
- The frontends share the contract (`newt/contract`, a module's `*.schema.ts`), never
  the code (chapter [23](./23-frontends)).
- An MCP server is another door to the same use cases; `via` says how someone came
  in, never what they may do (chapter [24](./24-mcp-server)).

**Running it.**

- The outbox is seen from outside: dead jobs are listed and run again from the
  backoffice (chapter [26](./26-dead-jobs-and-analytics)).
- One tracer for the whole process; newt makes the spans (chapter
  [28](./28-observability)).
- Migrate before you start; drain and stop serving before stopping the contexts (this
  chapter).

## The end

You have built cooper: three contexts, twenty modules, an OAuth server, two web
apps and a console, an MCP server, on SQLite or Postgres, traced. Every rule above is
somewhere in that code, and most of them are checked for you, by the compiler, the
lint or newt as it runs.

From here, the appendices are for looking things up:
[A. The golden rules](./a-golden-rules), [B. Module anatomy and lint](./b-module-anatomy),
[C. Common problems](./c-common-problems), [D. Writing a store](./d-writing-a-store),
[E. Index](./e-index), which says which chapter teaches each of newt's exports,
[F. Aggregates](./f-aggregates), how newt keeps an aggregate compared with other ways,
[G. The command line](./g-command-line), `newt init` and `newt add module`, and
[H. What an application knows of itself](./h-describe-application), what it says of itself while it runs.
The [reference](../reference/rules) has every detail the chapters left out.
