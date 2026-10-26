# Introduction

This tutorial teaches you to build a backend with newt by building one: cooper. You
start from a repository that has the framework and no application, and you write
cooper's backend chapter by chapter. At the end of every chapter the project
typechecks, its tests pass, its lint is clean, and you can run it and ask it
something.

It does not explain how the framework works inside. It explains **how to use it**:
which pieces there are, how they fit together, what each one guarantees and which
decisions are yours. When a chapter says "newt guarantees X", you can rely on it
without knowing how it does it.

## What you will build: cooper

cooper is a small Trello: workspaces with boards, boards with columns, columns with
cards. Around it there is what a real SaaS has: an account to sign in with, an OAuth
server, an MCP server for AI assistants, and a console for the company's staff.

It is split into three **contexts**, three parts of the backend with their own data
and their own server:

| Context | What it is | Port (dev) |
|---|---|---|
| `auth` | Who someone is: accounts, workspaces, who may enter what, and the OAuth server every app signs in with. | 3001 |
| `boards` | The SaaS itself: each workspace's boards, columns and cards, on the web and through MCP. | 3002 |
| `backoffice` | The staff's console: it reads `auth` and `boards`. | 3003 |

You build `boards` first, alone, and the other two once it stands.

### Two kinds of people

- **Members** use the SaaS. Anyone can sign up, create a workspace (they become its
  only admin) and invite others by email. An invited person who accepts becomes a
  member of that workspace.
- **Staff** work for the company that runs cooper. They do not sign up: someone gives
  them access to the backoffice.

### Products, tenants and access

`auth` does not know what a board is. It knows three things that let it serve any app:

- A **product** is an app that signs people in through `auth`. cooper has two:
  `cooper` (the boards app: anyone may sign up) and `backoffice` (only those given
  access).
- A **tenant** is a workspace: `Acme`, with the person who created it as its admin.
- An **access** says who may enter which product, and where: Ana in `cooper`, in the
  tenant Acme; the staff in `backoffice`, in no tenant at all.

So "Bob is a member of Acme" is, in `auth`, an access of Bob to the product `cooper`
in the tenant Acme. `boards` asks `auth` that question every time someone opens a
workspace.

### OAuth and MCP

`auth` is a full **OAuth 2.1 authorization server**: authorization codes with PKCE,
access and refresh tokens, and dynamic client registration. `boards` and `backoffice`
sign people in through it, as any other app would.

`boards` also has an **MCP server** at `/mcp`. An AI assistant (Claude, for one)
registers itself with `auth`, asks the person to sign in, and gets a token for
`boards`. With it, it calls tools such as `list_boards`, `create_card` or `move_card`,
which call the same use cases as the web app, as that person. cooper still knows how
each change came in: the person acting says whether it was through the web or through
MCP, and each card's activity shows it.

cooper also has three web frontends, one per context. The tutorial is about the
backend: the frontends are copied from the repository in chapter
[23](./23-frontends), where it shows what they share with the backend.

## The pieces

A backend made with newt is always made of the same few pieces. You will meet each
one in its chapter; here is the map:

| Piece | What it is | In cooper |
|---|---|---|
| **Context** | A part of the application with its own data and its own server. | `auth`, `boards`, `backoffice`. |
| **Module** | One responsibility inside a context: some data, its rules and what happens when it changes. | `board`, `column`, `card`, `tenant`, `access`… |
| **Entity** | What a module keeps, with its behaviour. | `Board`, `Card`, `Tenant`. |
| **Use case** | Each thing you can ask a module to do. | `board.create`, `card.move`. |
| **Repository** | The only thing that reads and writes a module's entities. | `Board_Repository`. |
| **Store** | Where a context keeps its data. | Plain files at first, then SQLite, then Postgres. |
| **Event** | Something that happened, told to whoever wants to hear it. | `card.assigned`, `tenant.created`. |
| **Worker** | Code that reacts to an event, afterwards and on its own. | Emailing the person a card was assigned to. |

This is how a request travels through them:

```
client ── POST /api/workspaces/:id/cards/:cardId/assign ──▶ route
route ── card.assign ──▶ use case ── changes ──▶ Card (entity)
use case ── persist ──▶ repository ── transaction ──▶ store
                         repository ┄┄ event card.assigned ┄┄▶ worker ── sends the email
```

Look at the dotted arrow. The route answers the client as soon as the card is saved;
the worker runs afterwards, on its own. That split between **what happens now** and
**what happens soon after** is the most important idea in newt. It has a name,
*eventual consistency*, and Part II is about it.

## The map

The tutorial has six parts. Each chapter adds to what the one before left.

**Part I — a first context.** `boards`, alone, from an empty folder to boards, columns
and cards that several people change at once.

| Chapter | What it adds |
|---|---|
| [1. The project and a context](./01-project-and-context) | cooper's TypeScript project, lint and `AGENTS.md`, the `boards` context on plain files, its health. |
| [2. The first module: boards](./02-first-module) | The `board` module, whole: entity, schema, value object, errors, repository, use cases, routes. |
| [3. Use cases, pages and errors](./03-pages-and-errors) | Lists by pages, and every error answered in cooper's words. |
| [4. Who and where](./04-who-and-where) | The actor, the workspace scope, a group of routes with its middleware. |
| [5. From files to SQLite](./05-sqlite) | SQLite and its migrations, with no module changed. |
| [6. Rules over rows](./06-rules-over-rows) | Columns, and rules that hold over several rows: at most ten, one name per workspace. |
| [7. Cards and a shared counter](./07-cards-and-a-counter) | Cards, numbered by a counter everybody moves at once. |
| [8. Two people, one card](./08-two-people-one-card) | Versions, conflicts and the use case that runs again. |
| [9. Asking twice: idempotent POSTs](./09-idempotent-posts) | A request sent twice that does its work once. |

**Part II — events.** What happens after a save, and in other modules.

| Chapter | What it adds |
|---|---|
| [10. Events](./10-events) | Domain events, published when the save commits. |
| [11. Reacting: handlers and the outbox](./11-reacting) | Workers on a queue, written in the same transaction as the change. |
| [12. What cannot be undone, and failures](./12-failures) | Emails from a worker, attempts, backoff and dead jobs. |
| [13. Listening to another context](./13-another-context) | An event source as a port, and the rule of who writes where. |
| [14. Sagas: a workspace comes and goes](./14-sagas) | A flow over several modules that converges. |
| [15. Queries a table cannot say: Kysely](./15-kysely) | Kysely on the store, and the filters a client may send. |
| [16. A search port of your own](./16-search-port) | A port, its in-memory adapter and its contract suite. |

**Part III — auth.** A second context, and the two talking.

| Chapter | What it adds |
|---|---|
| [17. A second context: auth](./17-auth) | Users and sessions, secrets kept out of DTOs, several contexts in one process. |
| [18. Tenants and access](./18-tenants-and-access) | Workspaces and who may enter them. |
| [19. Invitations and time](./19-invitations-and-time) | A clock you control, schedules and cron. |
| [20. Wiring contexts together](./20-wiring-contexts) | `boards` on the real `auth`, and the lint between contexts. |

**Part IV — signing in for real.**

| Chapter | What it adds |
|---|---|
| [21. An OAuth server](./21-oauth-server) | `auth` as an OAuth 2.1 server, routes outside `/api`, CORS. |
| [22. Signing in to boards: the web session](./22-web-session) | Cookies and sessions; the `x-user` header goes. |
| [23. The frontends and newt/contract](./23-frontends) | The web apps, and what they share with the backend. |
| [24. An MCP server](./24-mcp-server) | Bearer tokens and tools that call the same use cases. |

**Part V — the backoffice.**

| Chapter | What it adds |
|---|---|
| [25. A third context that reads two](./25-backoffice) | The staff's console, through the other contexts' use cases. |
| [26. Dead jobs and analytics](./26-dead-jobs-and-analytics) | The outbox seen from outside, and an analytics port. |

**Part VI — production.**

| Chapter | What it adds |
|---|---|
| [27. Postgres, MySQL and migrations in production](./27-postgres) | A database server, migrations per dialect, and running them by hand. |
| [28. Observability](./28-observability) | Traces, to the console or to OpenTelemetry. |
| [29. Shipping it](./29-shipping) | The build, the settings, and the rules once more. |

The appendices gather what the chapters teach one at a time:
[A. The golden rules](./a-golden-rules), [B. Module anatomy and lint](./b-module-anatomy),
[C. Common problems](./c-common-problems), [D. Writing a store](./d-writing-a-store)
[E. Index](./e-index), which says which chapter teaches each of newt's exports,
[F. Aggregates](./f-aggregates), how newt keeps an aggregate compared with other ways, and
[G. The command line](./g-command-line), `newt init` and `newt add module`.

## How you work

You need [git](https://git-scm.com) and [Bun](https://bun.sh) 1.4.4 or later (the gate
below uses its `bun check`). newt runs only on Bun: its stores are built on `bun:sqlite`
and `Bun.SQL`, and its server on `Bun.serve`.

Clone the newt repository and go to the start of the tutorial:

```sh
git clone https://github.com/aromero86/newt.git
cd newt
git checkout tutorial/00
bun install
```

`tutorial/00` is a tag: the repository as it is before chapter 1. Make a branch of
your own on it, so your work has a name:

```sh
git switch -c my-cooper
```

### What is there at the start

The repository is one Bun workspace. At `tutorial/00` it has:

```
package.json          the workspace: newt, newt-eslint, typescript, eslint, vitepress
tsconfig.json         the repository's TypeScript projects: for now only newt's
tsconfig.newt.json    newt's project: the framework and its tests
eslint.config.js      lints nothing yet: the framework's code is left out
packages/
  newt/               the framework: newt/core, newt/runtime, newt/http…, its `newt`
                      command and its AGENTS.md, the rules for coding agents
  newt-eslint/        the lint of an application built with newt
web/                  this site
```

The root `package.json` already depends on `newt` (`"workspace:*"`) and has
`newt-eslint` among its dev dependencies. cooper imports the framework by its name,
`newt/core`, `newt/http`, exactly as an application that ran `bun add newt` would:
each entry is one of the `exports` of `packages/newt/package.json`, and nothing else in
the package can be imported.

There is no `cooper/` folder. You create it in chapter 1.

### One chapter, one tag

Each chapter ends at a tag: chapter 1 at `tutorial/01`, chapter 2 at `tutorial/02`,
and so on up to `tutorial/29`, which is the whole of cooper. A chapter shows every line
you type, with its path above it. A file shown whole is new, or replaced whole; a file
shown in parts has `// …` where its other lines stay as they were, and the text says
where each part goes.

When you finish a chapter, compare what you wrote with its tag:

```sh
git diff tutorial/03 -- cooper
```

To see everything a chapter changes, before or after you read it:

```sh
git diff tutorial/02 tutorial/03
```

If you fall behind, or want to skip a chapter, take the code of its tag:

```sh
git checkout tutorial/03 -- cooper
```

That brings `cooper/` as the tag has it. It adds and replaces files, and leaves alone
the ones you have that the tag does not: `git diff tutorial/03 -- cooper` shows them.
Some chapters also change files at the root (`package.json`, `tsconfig*.json`,
`eslint.config.js`): the chapter says so, and you take them the same way, then run
`bun install`:

```sh
git checkout tutorial/03 -- cooper package.json bun.lock tsconfig.json tsconfig.backend.json eslint.config.js
bun install
```

A few chapters copy files from the repository instead of typing them (the frontends,
protocol code the chapter summarises). They say exactly which paths, and from which
tag.

### The gate

Every chapter ends with the same four checks:

```sh
bun install && bun check && bun test cooper && bun run lint
```

- `bun check` typechecks every project the root `tsconfig.json` references, as
  `tsc -b` would: newt's, and from chapter 1 cooper's backend. It reports the same
  errors as `tsc`, and ends with `✓ No type errors` when all is well.
- `bun test cooper` runs cooper's tests. Every chapter's check is also a test, so what
  you try by hand is checked again each time.
- `bun run lint` runs ESLint with newt's preset over cooper's backend.

At `tutorial/00` there is no cooper yet: run `bun test` instead, which runs newt's own
tests, to see the repository is sound before you start.

Then each chapter has its own "Check it": the server started by hand, and a few `curl`
lines with what they answer.

## In short

- cooper has three contexts: `auth` (identity and OAuth), `boards` (the SaaS, with an
  MCP server) and `backoffice` (the staff's console). You build `boards` first.
- Members use workspaces; staff use the backoffice. In `auth`, a workspace is a tenant
  and membership is an access to a product.
- Clone, `git checkout tutorial/00`, `bun install`. Each chapter ends at
  `tutorial/NN`; `git diff tutorial/NN-1 tutorial/NN` shows it,
  `git checkout tutorial/NN -- cooper` catches you up.
- The gate, at the end of every chapter:
  `bun install && bun check && bun test cooper && bun run lint`.

Start with [chapter 1: the project and a context](./01-project-and-context).
