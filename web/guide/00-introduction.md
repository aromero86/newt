# Introduction

This guide teaches you to build a backend with newt. It goes from simple to complex,
like a book: each chapter stands on the one before, and by the end you have read the
backend of a whole application and know why it is built the way it is.

It does not explain how the framework works inside. It explains **how to use it**:
which pieces there are, how they fit together, what each one guarantees and which
decisions are yours. When the guide says "the framework guarantees X", you can rely on
it without knowing how it does it.

## What you will read: cooper

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
which call the same use cases as the web app, as that person.

cooper also has three web frontends, one per context, in `cooper/frontend`. This guide
does not cover them: it is about the backend.

## What you will learn

| Part | Chapters | What it teaches |
|---|---|---|
| First steps | [1](./01-the-project) – [4](./04-use-cases) | The project, a context, your first module, use cases. |
| Who and where | [5](./05-who-and-where) | The actor, signing in, permissions, the workspace scope. |
| Saving without fear | [6](./06-transactions) – [9](./09-shared-counters) | Transactions, two people changing one card, rules over several rows, counters everyone changes. |
| Events | [10](./10-events) – [16](./16-sagas) | Events, workers, eventual consistency, workers that can repeat, emails, failures, sagas. |
| Growing | [17](./17-modules-talk) – [19](./19-several-contexts) | Modules that talk, references, several contexts. |
| cooper's own | [20](./20-oauth-server) – [22](./22-backoffice) | An OAuth server, an MCP server, the backoffice. |
| Data and production | [23](./23-search) – [26](./26-production) | Searching, migrations, tests, production. |

Each chapter follows the same steps: the problem, what newt gives you for it, the
code (copied from cooper, with its path above it), how to check it works, and the rule
to remember.

## Run it

You need [Bun](https://bun.sh) 1.4 or later. newt runs only on Bun.

```bash
bun install
bun run cooper:seed
bun run cooper
```

`bun run cooper:seed` writes the demo data through the contexts' use cases, as anyone
would: a staff account, Ana's workspace Acme with two boards (Welcome and Launch), and
Bob, who joined Acme by accepting Ana's invitation. You can run it again: what is
there stays. The emails it sends go to the console. At the end it prints:

```
cooper is seeded. Every account's password is
  cooper-demo

  staff@cooper.dev   the staff: the backoffice, http://localhost:5173
  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation

  MCP server         http://localhost:5172/mcp (OAuth: sign in as Ana or Bob)
```

`bun run cooper` starts the backend (the three contexts in one process, each on its
port) and a Vite server per frontend, and restarts the backend on every change. When
everything answers, it prints where each app lives:

```
  auth        http://localhost:5171  (API on port 3001)
  boards      http://localhost:5172  (API on port 3002)
  backoffice  http://localhost:5173  (API on port 3003)
```

Open `http://localhost:5172` and sign in as `ana@cooper.dev` with `cooper-demo`.
Press Ctrl+C to stop it all. What cooper keeps goes to `data/`, one SQLite file per
context: delete the folder to start again.

::: tip
Every port and URL can be changed with an environment variable (`COOPER_BOARDS_PORT`,
`COOPER_BOARDS_PUBLIC_URL`…). Chapter [2](./02-a-context) shows where they are read.
:::

## The map of the repository

Only the backend, which is what the guide is about:

```
packages/
  newt/                   the framework: newt/core, newt/runtime, newt/http…
  newt-eslint/            the lint of an application built with newt
cooper/
  backend/
    index.ts              opens the contexts, serves each one, stops them
    config.ts             the settings, from environment variables
    open-contexts.ts      opens auth, boards and backoffice, in that order
    shared/               what every context uses: its base, its server, the web session, a mailer
    contexts/
      auth/               accounts, workspaces, access, invitations, the OAuth server
      boards/             boards, columns and cards; the MCP server in mcp/
      backoffice/         the staff's console
  scripts/
    dev.ts                bun run cooper
    seed.ts               bun run cooper:seed
data/                     the SQLite files (not in git)
```

Inside a context there are always the same pieces, and inside each module of it, the
same files. Here is `boards`, the context you will build first:

```
cooper/backend/contexts/boards/
  boards.context.ts       the context: opens its store, its modules and its server
  boards-base.ts          what each of its modules receives
  boards-config.ts        its settings
  initialize-modules.ts   its modules, each after the ones it uses
  migrations/             its tables, in SQL
  modules/
    board/  column/  card/  member/  workspace/
  mcp/                    its MCP server
  testing/                what its tests open
```

## The pieces

Before you write code, it helps to have the map of the pieces. A backend made with
newt is always made of the same few:

| Piece | What it is | In cooper |
|---|---|---|
| **Context** | A part of the application with its own data and its own server. | `auth`, `boards`, `backoffice`. |
| **Module** | One responsibility inside a context: some data, its rules and what happens when it changes. | `board`, `column`, `card`, `tenant`, `access`… |
| **Entity** | What a module keeps, with its behaviour. | `Board`, `Card`, `Tenant`. |
| **Use case** | Each thing you can ask a module to do. | `board.create`, `card.move`. |
| **Repository** | The only thing that reads and writes a module's entities. | `Board_Repository`. |
| **Store** | Where a context keeps its data. | SQLite, one file per context. |
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
**what happens soon after** is the most important idea in this guide. It has a name,
*eventual consistency*, and chapters [10](./10-events) to [16](./16-sagas) are about it.

## The rules that never break

A few rules keep the code tidy while the application grows. Here they are, all
together. You do not need to understand them yet: each one is explained in its
chapter, and it is worth coming back to this list now and then.

1. **One module, one responsibility.** If you need an "and" to describe it, it is two.
2. **A route does not think.** It reads the request, calls a use case and answers.
3. **Only the entity changes itself**, with methods that say what happened.
4. **Only the repository touches the store.**
5. **A transaction is one save**, not a whole use case.
6. **A module reads from others whenever it wants, but writes into another only from
   a worker**, reacting to an event.
7. **What cannot be undone (an email, a charge) leaves from a worker**, never from a
   use case.
8. **A worker may run more than once**, so it must not matter if it does.
9. **Dependencies between modules never make a circle.**
10. **A module points at another's things only by their id**, never by the entity or
    its table.
11. **No list is returned whole**: it is paged.

## In short

- cooper has three contexts: `auth` (identity and OAuth), `boards` (the SaaS, with an
  MCP server) and `backoffice` (the staff's console).
- Members use workspaces; staff use the backoffice. In `auth`, a workspace is a tenant
  and membership is an access to a product.
- `bun install`, `bun run cooper:seed`, `bun run cooper`; password `cooper-demo`.
- The guide is about the backend: `cooper/backend` and the framework in `packages/newt`.
