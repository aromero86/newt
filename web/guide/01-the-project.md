# The project

Before the first module, the project around it: one Bun workspace, the framework
imported by its name, and three checks that keep the code honest (types, lint and
tests).

## One package, at the root

cooper has no `package.json` of its own. The whole repository is one Bun workspace,
with every dependency in the root `package.json`, at an exact version:

```json
// package.json
{
  "name": "newt-workspace",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "typecheck": "bun check",
    "test": "bun test",
    "lint": "eslint",
    "cooper": "bun run cooper/scripts/dev.ts --watch",
    "cooper:seed": "bun run cooper/scripts/seed.ts",
    "cooper:migrations": "bun run cooper/scripts/migrations.ts",
    // …
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.1",
    "kysely": "0.29.6",
    // …
    "zod": "4.3.6"
  },
  // …
}
```

The backend needs little: `zod`, with which every piece of data is described, and
`kysely` for the queries a table cannot express (chapter [22](./22-backoffice)). The
MCP SDK is for `boards`' MCP server.

The `cooper*` scripts run the application: `cooper` starts it in development,
`cooper:seed` fills it with example data, and `cooper:migrations` shows, applies and
reverts each context's migrations by hand (`bun run cooper:migrations status`,
chapter [24](./24-migrations)). The server migrates on its own as it opens each
context; the script is for looking before a deploy, or for going back one.

You need Bun 1.4 or later. newt runs only on Bun: its stores are built on `bun:sqlite`
and `Bun.SQL`, and its server on `Bun.serve`.

## newt, by its name

In your own project you would `bun add newt zod`. In this repository the framework is
next door, in `packages/newt`, and cooper imports it by its name anyway, exactly as an
application that installed it would:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
```

What makes `newt/runtime` land in `packages/newt/runtime/index.ts` is one alias in the
root `tsconfig.json`, which Bun reads to resolve imports:

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "newt/*": ["./packages/newt/*/index.ts"],
      // …
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

The repository is four TypeScript projects: the framework, what runs on the server,
what runs in the browser, and the scripts. The backend's is plain TypeScript for Bun,
strict and without the DOM, and it holds cooper's backend only:

```json
// tsconfig.backend.json
{
  // cooper's backend, on Bun, with the framework it imports. No DOM. Apart from newt's
  // own project (tsconfig.newt.json), as an application has newt apart: what cooper
  // adds to newt's types (its Actor, shared/actor.ts) is cooper's only.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": { "newt/*": ["./packages/newt/*/index.ts"] }
  },
  "include": ["cooper/backend/**/*.ts"],
  "exclude": ["**/node_modules"]
}
```

Why is newt a project of its own (`tsconfig.newt.json`, the same options over
`packages/**/*.ts`)? Because an application adds to newt's types. cooper says, once,
how someone reached it: through the web or through the MCP server.

```ts
// cooper/backend/shared/actor.ts
declare module 'newt/core' {
  interface Actor {
    via: ActorVia
  }
}
```

A `declare module` reaches every file of the project it is in. In one project with
cooper, newt's own code and tests would be checked against cooper's `Actor`, where
`via` is required, and an actor of newt's tests, `{ userId }`, would be an error that
is not newt's. Checked apart, newt is checked as it ships; cooper, as it uses it. Chapter
[5](./05-who-and-where) is about the actor.

::: warning
newt uses TypeScript's standard decorators (`@UseCase()`). Do **not** turn on
`experimentalDecorators`: it switches TypeScript to the old, non-standard decorators,
which are not the ones newt is written for.
:::

## The doors of the framework

newt is imported through these subpaths, and no others:

| Import | What for |
|---|---|
| `newt/core` | The essentials: modules, entities, use cases, events, errors, the actor, scopes, criteria, filters, value objects. |
| `newt/repository` | Repositories: where a module reads and saves its entities. |
| `newt/runtime` | A running context: `Base`, `BoundedContext`. |
| `newt/http` | The HTTP router and the server. |
| `newt/adapter-sqlite` | The SQLite store, cooper's. |
| `newt/adapter-files`, `newt/adapter-postgres`, `newt/adapter-mysql` | The other stores. |
| `newt/kysely` | Your own queries with Kysely, over a SQL store. |
| `newt/port-store`, `newt/port-outbox`, `newt/port-analytics` | The ports: what a store, an outbox or an analytics adapter implements. |
| `newt/sql`, `newt/port-store/contract`, `newt/port-analytics/contract` | For whoever writes an adapter. |

cooper's backend uses `newt/core`, `newt/repository`, `newt/runtime`, `newt/http`,
`newt/adapter-sqlite` and `newt/kysely`. The rest are for other stores and for
whoever writes an adapter.

## Typecheck

```bash
bun run typecheck
```

It runs `bun check`, which follows the four projects of the root `tsconfig.json` and
reports what `tsc` would:

```
✓ No type errors in 1,411 files across 4 projects
```

Keep it clean. newt leans on the compiler more than most frameworks: a use case's
input and output, an event's payload, the fields of a criteria and the parameters of a
route are all typed, and a mistake there is a type error before it is a bug.

## Lint: newt-eslint

The compiler checks types. It cannot check that a module is put together the way
every other module is, or that one context does not reach into another. That is what
`newt-eslint` is for. cooper's `eslint.config.js` applies its preset to the backend
and the scripts, and tells it which context may use which:

```js
// eslint.config.js
import { newt } from 'newt-eslint'
// …
const BACKEND = newt({
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
// …
export default [
  { ignores: ['packages/**', 'docs/**', 'web/**', '**/dist/**'] },
  ...within(['cooper/backend', 'cooper/scripts'], BACKEND),
  // … the frontend's own rules
]
```

`uses` is the shape of the application: `auth` uses nothing, `boards` uses `auth`, and
`backoffice` uses both. A cycle, or a context it does not know, is an error when the
lint starts.

These are the rules:

| Rule | What it says |
|---|---|
| `newt/module-anatomy` | A module is made of the files every module has, named after it: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, its tests, and the folders `events`, `errors`, `value-objects` and `services`. |
| `newt/module-boundaries` | A module imports from another only its module, schema, events, errors and value objects: never its entity, repository, routes or workers. |
| `newt/queue-name` | A worker's queue is named `<module>.<use case>.on.<module>.<event>` (chapter [11](./11-reacting)). |
| `newt/context-boundaries` | A context imports only the contexts `uses` gives it. |

The preset also refuses `store.transaction` inside a module (a module saves through its
repository, chapter [6](./06-transactions)) and a promise left without `await`.

```bash
bun run lint
```

Try breaking a rule to see what it says. A file in `auth` that imports the backoffice:

```
cooper/backend/contexts/auth/zz-lint.ts
  1:36  error  '../backoffice/backoffice.context' is the context backoffice's, and auth uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

And a file in the `card` module that reaches for `board`'s repository:

```
cooper/backend/contexts/boards/modules/card/zz.ts
  1:1   error  'zz.ts' is not a file a module has: its files are card.module.ts, card.ts, card.schema.ts, card.repository.ts, card.routes.ts, card.workers.ts, card.deps.ts, card-options.ts and *.test.ts  newt/module-anatomy
  1:34  error  '../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects                     newt/module-boundaries
```

::: tip
typescript-eslint does not run on TypeScript 7 yet. The root `package.json` installs
TypeScript 6 as `typescript`: `"typescript": "npm:@typescript/typescript6@6.0.2"`.
:::

## Tests

```bash
bun test
```

Bun finds every `*.test.ts` and runs it. cooper's tests open the real contexts, with
SQLite in memory, and use them as a route, a worker or a script would: no mocks of the
framework. You will write the first one at the end of chapter
[3](./03-first-module), and chapter [25](./25-tests) is about them.

To run one context's tests, give its folder:

```bash
bun test cooper/backend/contexts/boards
```

```
 48 pass
 0 fail
 130 expect() calls
Ran 48 tests across 6 files.
```

## Where things go

Everything of a context lives in its folder, and every module in a folder of its own
inside `modules/`, with always the same files:

```
cooper/backend/contexts/boards/modules/board/
  board.schema.ts          the contract: what goes in and comes out
  board.ts                 the entity
  value-objects/           values with rules of their own
  events/                  what can happen
  errors/                  what can go wrong
  board.repository.ts      how it is kept
  board.deps.ts            the modules it uses
  board.module.ts          its use cases
  board.routes.ts          its HTTP API
  board.test.ts            its tests
```

The lint knows these names. The next chapter builds the context that holds them, and
chapter [3](./03-first-module) writes each file of `board`.

## In short

- One root `package.json` with exact versions; cooper has none of its own.
- newt is imported by its name (`newt/core`…), through the `paths` of the root
  `tsconfig.json`. Standard decorators: never `experimentalDecorators`.
- The framework and the backend are separate TypeScript projects: what the
  application adds to newt's types stays the application's.
- `bun run typecheck`, `bun run lint` and `bun test` must stay clean.
- newt-eslint keeps every module the same shape, keeps modules out of each other's
  insides, and keeps contexts to the ones they `use`.
