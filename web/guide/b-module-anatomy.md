# B. A module's anatomy, and the lint

Every module of cooper has the same files, named after it, so whoever opens one knows
where everything is. A module is a folder in its context's `modules/`, in kebab case:
`cooper/backend/contexts/<context>/modules/<module>/`. This appendix lists the files and
what each holds, then every rule of `newt-eslint`, with the error each one gives.

## The files

| File | What it holds | Since |
|---|---|---|
| `<m>.schema.ts` | The zod schemas, the DTO types, the input schemas and the filters: the module's **public contract**. Other modules, other contexts and the API clients import it. It imports only zod, `newt/contract`, value objects and other schemas. | [2](./02-first-module), [23](./23-frontends) |
| `<m>.ts` | The entity, a class extending `Entity`: the only code that changes the module's state. It re-exports the schema. | [2](./02-first-module) |
| `<m>.repository.ts` | The only file that touches the store: a `TableRepository` over the module's table, its saves with their `guard`, `before` and `after`, and any Kysely query. | [2](./02-first-module), [6](./06-rules-over-rows) |
| `<m>.module.ts` | `<M>_Module`: its use cases (`@UseCase`), its `events` (`eventsOf(base.bus, { … })`), and `static initialize`, which builds the repository and registers routes and workers. | [2](./02-first-module), [10](./10-events) |
| `<m>.routes.ts` | Its routes, if it has any: read the request, call a use case, answer. | [2](./02-first-module) |
| `<m>.workers.ts` | Its reactions to events and schedules (`….subscribe(…, { strategy: 'handler', queue })`), if it has any. | [11](./11-reacting) |
| `<m>.deps.ts` | `<M>_Deps`: the modules of its context it calls, and the ports it needs from outside its context, imported as types. | [4](./04-who-and-where), [13](./13-another-context) |
| `<m>-options.ts` | `<M>_Options`: what its context configures it with (a mailer, a URL, a number of days, an adapter). | [7](./07-cards-and-a-counter), [12](./12-failures) |
| `events/<m>-<verb>.ts` | One event per file, its class named `<M>_<Verb>`. | [10](./10-events) |
| `errors/<error>.ts` | One error per file, with a stable `code`; its base class decides the status. | [2](./02-first-module), [3](./03-pages-and-errors) |
| `value-objects/<name>.ts` | Its value objects, if it has any. | [2](./02-first-module) |
| `services/<name>.ts` | Logic its use cases share, one file each. | |
| `*.test.ts` | Its tests, beside what they test. | [2](./02-first-module) |

Only `<m>.module.ts` is always there. boards' `card` has almost all of them:

```text
cooper/backend/contexts/boards/modules/card/
  card.schema.ts       CardSchema, CardCreateSchema, CardFilter, MAX_CARDS, CardDTO…
  card.ts              Card, the entity; re-exports the schema
  card.repository.ts   persistNew, persistOrder, nextNumber, countByBoard, purgeWorkspace…
  card.module.ts       Card_Module: create, edit, move, assign, search, removeColumn…
  card.routes.ts       under /workspaces/:workspaceId: /boards/:boardId/cards, /cards/…
  card.workers.ts      notify the assignee, index each card, leave a removed column,
                       unassign someone whose access was revoked
  card.deps.ts         board, column, member, and auth's access events (a port)
  card-options.ts      the mailer, boards' public URL, the card search
  card.test.ts
  events/              card-created.ts, card-edited.ts, card-moved.ts, card-assigned.ts,
                       card-unassigned.ts, card-deleted.ts
  errors/              card-not-found.ts, column-not-empty.ts, column-not-in-board.ts,
                       assignee-not-member.ts, too-many-cards.ts
```

`board` is the shape most modules have, without workers or options:

```text
cooper/backend/contexts/boards/modules/board/
  board.schema.ts  board.ts  board.repository.ts  board.module.ts  board.routes.ts
  board.deps.ts    board.test.ts
  events/          board-created.ts, board-updated.ts, board-archived.ts
  errors/          board-not-found.ts, board-name-taken.ts, invalid-board-name.ts
  value-objects/   board-name.ts
```

And a module that keeps nothing has no entity and no repository: the backoffice's
`workspace` is a module, its deps, its routes, its schema and its test
([chapter 25](./25-backoffice)).

A module every context needs alike lives in `cooper/backend/shared/<module>/`, with
the same files and names, and each context initializes its own over its own store:
`shared/web-session` (each web app's sessions, [chapter 22](./22-web-session)) and
`shared/outbox` (a context's dead jobs, [chapter 12](./12-failures)). It belongs to no
context and imports none of them. It is in no `modules/` folder, so the lint's module
rules do not check it: keep its anatomy by hand.

## Names

For a module about OAuth grants, as auth has it ([chapter 21](./21-oauth-server)):

| What | Name |
|---|---|
| Folder | `oauth-grant` |
| Module class | `OauthGrant_Module` |
| Module name (`super('…')`) | `oauthGrant` |
| Entity | `OauthGrant` |
| Repository | `OauthGrant_Repository` |
| Table | `oauth_grant` |
| Use case | `oauthGrant.redeem` |
| Event | `oauthGrant.replayed`, class `OauthGrant_Replayed`, file `events/oauth-grant-replayed.ts` |
| Error | `errors/invalid-grant.ts`, code `oauthGrant.invalid_grant` |
| A worker's queue | `token.revokeGrant.on.oauthGrant.replayed` |

The queue names who reacts (`token`), with what (`revokeGrant`), to which event
(`oauthGrant.replayed`). Renaming any of the three renames the queue, and leaves the
jobs already waiting under the old name ([chapter 11](./11-reacting)).

## Beside the modules

A context has a few files of its own beside `modules/` ([chapter 1](./01-project-and-context)):

| File | What it holds |
|---|---|
| `<context>.context.ts` | `<Context>_Context`: `open` opens its store, creates its base and initializes its modules; `start` and `stop` its worker. |
| `initialize-modules.ts` | Each module, after the ones it uses. |
| `<context>-base.ts` | Its base: cooper's base, with what its modules need. |
| `<context>-config.ts` | The type of what it is configured with. |
| `migrations/sqlite/`, `migrations/postgres/` | Its migrations, one folder per dialect ([chapter 5](./05-sqlite), [27](./27-postgres)). |
| `testing/` | What its tests open it with, and fakes of what it needs from outside. |

## The lint

cooper's `eslint.config.js` applies `newt-eslint`'s preset to the backend and the
scripts, with its contexts and which ones each one uses
([chapter 1](./01-project-and-context)):

```js
// eslint.config.js
import { newt } from 'newt-eslint'
// …
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
// …
```

Run it with `bun run lint`. The preset turns on seven checks: five rules of newt's own
(`newt/…`), one restriction, and one rule of typescript-eslint. The errors below are
real: each was written into `card/` on purpose and linted.

### `newt/module-anatomy`

**Where**: every file under a `modules/<module>/` folder.
**What it checks**: the file is one a module has (`<m>.module.ts`, `<m>.ts`,
`<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`,
`<m>.deps.ts`, `<m>-options.ts`, `*.test.ts`), or sits in one of its folders (`events`,
`errors`, `value-objects`, `services`); and an event's file starts with the module's
name.

```text
card/card.helpers.ts
  1:1  error  'card.helpers.ts' is not a file a module has: its files are card.module.ts, card.ts, card.schema.ts, card.repository.ts, card.routes.ts, card.workers.ts, card.deps.ts, card-options.ts and *.test.ts  newt/module-anatomy

card/utils/format.ts
  1:1  error  'utils' is not a folder a module has: its folders are events, errors, value-objects, services  newt/module-anatomy

card/events/moved-card.ts
  1:1  error  An event's file is named 'card-<event>.ts', not 'moved-card.ts'  newt/module-anatomy
```

Fix: put the code where its kind goes (shared logic in `services/`), or name the file
after the module.

### `newt/module-boundaries`

**Where**: every file under a `modules/<module>/` folder.
**What it checks**: an import from another module lands on its module, its schema, its
events, its errors or its value objects. Never its entity, repository, tables, routes or
workers, nor its folder (`../board`). Relative paths and tsconfig aliases alike.

```ts
import { Board } from '../board/board'
import { Board_Repository } from '../board/board.repository'
```

```text
  1:23  error  '../board/board' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
  2:34  error  '../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
```

Fix: call a use case of `Board_Module` through the module's deps, and use its DTO
([chapter 6](./06-rules-over-rows)).

### `newt/schema-imports`

**Where**: a module's `<m>.schema.ts`.
**What it checks**: it takes from newt only `newt/contract`. A frontend imports the
schema ([chapter 23](./23-frontends)); `newt/core` and newt's other entries are the
server's (they keep scopes on `AsyncLocalStorage` and reach Bun), so not even a type
comes from them. Only the schema's own imports are read, not those of the files it
imports.

```ts
import { now } from 'newt/core'
import type { Criteria } from 'newt/core'
```

```text
card/card.schema.ts
  1:21  error  'newt/core' is the server's: card.schema.ts is imported by the frontend, so it takes from newt only 'newt/contract' (value objects and their errors, defineFilter, Page, PageRequest, ErrorBody)  newt/schema-imports
  2:31  error  'newt/core' is the server's: card.schema.ts is imported by the frontend, so it takes from newt only 'newt/contract' (value objects and their errors, defineFilter, Page, PageRequest, ErrorBody)  newt/schema-imports
```

Fix: take it from `newt/contract` if it is there (value objects and their errors,
`defineFilter`, `Page`, `PageRequest`, `ErrorBody`), or keep it out of the schema.

### `newt/queue-name`

**Where**: every file under a `modules/<module>/` folder.
**What it checks**: a handler's `queue` is `<module>.<use case>.on.<module>.<event>`;
it starts with the module whose file it is in; its callback calls that use case on that
module; and it ends with the event it is subscribed under (`events.assigned` →
`….assigned`). It reports four different mistakes:

```ts
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'notify-assignee' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'board.notifyAssignee.on.card.assigned' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'card.notify.on.card.assigned' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'card.notifyAssignee.on.card.created' })
```

```text
  error  'notify-assignee' is not a handler's queue: it is '<module>.<use case>.on.<module>.<event>', as 'order.fulfil.on.order.placed'  newt/queue-name
  error  This queue is 'card.…': the handlers in card.workers.ts are card's, so their queues start with 'card.', not 'board.'  newt/queue-name
  error  This queue says the handler calls card's 'notify', but its callback calls no 'notify' of card: name the use case it calls  newt/queue-name
  error  This queue ends with '.on.….assigned', the event it subscribes to  newt/queue-name
```

Fix: `card.notifyAssignee.on.card.assigned`. newt itself refuses at startup a queue that
does not end with its event ([appendix C](./c-common-problems#workers)); the lint
catches that and the rest in the editor ([chapter 11](./11-reacting)). A subscription
that is no module's (a test's own reaction) has no use case to name: turn the rule off
for that line, saying why.

### `newt/context-boundaries`

**Where**: every file under `contexts.folder`, when the preset is given `contexts`.
**What it checks**: a context imports only the contexts its `uses` lists. A context
folder that `uses` does not list may import no other context.

```ts
// in a file of boards
import { Staff_Module } from '../../../backoffice/modules/staff/staff.module'
```

```text
  3:30  error  '../../../backoffice/modules/staff/staff.module' is the context backoffice's, and boards uses auth: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

Fix: what boards needs of the backoffice goes the other way round, or through a port in
boards' own words ([chapter 20](./20-wiring-contexts)).

`uses` itself is checked when the preset is built, before any file is linted. Each
mistake throws, and `bun run lint` stops with it:

```text
newt-eslint: contexts never use each other in a cycle, and `uses` says auth → boards → auth.
newt-eslint: the context 'boards' uses 'auth', which is not in `uses`: list every context, each with the ones it uses ([] for none).
```

### No transaction in a module

**Where**: every file under a `modules/<module>/` folder (ESLint's
`no-restricted-syntax`, configured by the preset).
**What it checks**: `transaction`, called or taken: `store.transaction(…)`,
`store['transaction']`, `const { transaction } = store`.

```ts
base.store.transaction(async () => {})
```

```text
  8:3  error  A module writes through its repository's save (or saveRows), which runs the transaction, checks the write rule and publishes the events: never in a transaction of its own  no-restricted-syntax
```

Fix: write through the repository's `save` (or `saveRows` around several tables,
[chapter 14](./14-sagas)).

### `@typescript-eslint/no-floating-promises`

**Where**: every file the preset lints.
**What it checks**: no promise is left without `await`, `.catch`, or a `void` that says
it on purpose. The same line as above also gives:

```text
  8:3  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
```

Fix: `await` it. A call left unawaited inside a transaction runs after the transaction
ended, and fails ([appendix C](./c-common-problems#saving)). The rule needs every
linted file in a TypeScript project: cooper's root `tsconfig.json` references one per
part ([chapter 20](./20-wiring-contexts)).

### What the lint does not check

- The anatomy of `shared/` modules, which are in no `modules/` folder.
- What a schema's value objects import: `newt/schema-imports` reads only the schema's
  own imports. A value object that imports `newt/core` reaches the frontend through
  it, and Vite warns about `node:async_hooks` ([chapter 23](./23-frontends)).
- The write rule and the guard rule: newt checks those as the code runs
  ([chapter 8](./08-two-people-one-card), [chapter 6](./06-rules-over-rows)).

cooper's `eslint.config.js` adds rules of its own for the frontends (no styling outside
`@cooper/ui`, no backend import but a module's `*.schema.ts`); they are cooper's, not
newt-eslint's ([chapter 23](./23-frontends)).
