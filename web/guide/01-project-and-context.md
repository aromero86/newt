# The project and a context

Before the first board there has to be somewhere to put it. This chapter makes cooper's
backend a project of the repository, with its own TypeScript settings and newt's lint,
and builds its first **context**, `boards`: a part of the application with its own
data, its own modules and its own server. It has no module yet. It opens its store,
serves itself on port 3002 and answers one question: is it up?

At the end you will have these files:

```
tsconfig.json              changed: it references the backend's project
tsconfig.backend.json      the backend's TypeScript project
eslint.config.js           changed: newt's lint on the backend
cooper/backend/
  config.ts                the settings, from environment variables
  index.ts                 opens boards and serves it
  shared/
    cooper-base.ts         what every module of cooper receives
    served-context.ts      a context that serves itself on its port
  contexts/boards/
    boards-base.ts         what every module of boards receives
    boards-config.ts       its settings
    boards.context.ts      the context: opens its store, its modules, its server
    initialize-modules.ts  its modules: none yet
    boards.context.test.ts its first test
```

## A TypeScript project for the backend

The repository is made of TypeScript projects. At `tutorial/00` there is one, newt's.
cooper's backend gets its own: plain TypeScript for Bun, strict, without the DOM.
Create `tsconfig.backend.json` at the root:

```json
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
    "strict": true
  },
  "include": ["cooper/backend/**/*.ts"],
  "exclude": ["**/node_modules"]
}
```

And make the root `tsconfig.json` reference it, beside newt's:

```json
{
  // The whole repository, as its projects: the framework (newt) and what runs on the
  // server (cooper's backend). `bunx tsc -b` follows the references. newt is not among
  // any paths: it is a workspace package, reached through its `exports` as any
  // application reaches it.
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" }
  ]
}
```

Why two projects, and not one? Because an application adds to newt's types. In
chapter [4](./04-who-and-where) cooper says, once, what more it knows about whoever
is acting (whether they came through the web or through MCP), with a `declare module
'newt/core'`. A `declare module` reaches every file of the project it is in. In one
project with cooper, newt's own tests would be checked against cooper's additions and
fail for reasons that are not newt's. Checked apart, newt is checked as it ships, and
cooper as it uses it.

There are no `paths` either. newt is a package of the workspace, and cooper reaches it
through its `exports`, as an application that installed it from npm would.

::: warning
newt uses TypeScript's standard decorators (`@UseCase()`, from the next chapter). Do
**not** turn on `experimentalDecorators`: it switches TypeScript to the old,
non-standard decorators, which are not the ones newt is written for.
:::

## Lint: newt-eslint

The compiler checks types. It cannot check that a module is put together the way
every other module is, or that one context does not reach into another. That is what
`newt-eslint` is for. Replace the root `eslint.config.js`:

```js
import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint. The
// framework's own code is not an application, so it is left out.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { boards: [] } },
})

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
]
```

`newt(options)` is the preset: its rules, the TypeScript parser, and the files they
look at. `files` keeps it to the backend. `contexts` says where the contexts live and
which ones each one uses: for now there is one, `boards`, and it uses none. A context
it does not list, or a cycle, is an error as soon as the lint starts.

These are its rules. You will meet each one when you first break it:

| Rule | What it says |
|---|---|
| `newt/module-anatomy` | A module is made of the files every module has, named after it. |
| `newt/module-boundaries` | A module reaches another only through its use cases, schema, events, errors and value objects. |
| `newt/queue-name` | A worker's queue is named after the use case it calls and the event it hears. |
| `newt/context-boundaries` | A context imports only the contexts `uses` gives it. |

The preset also refuses a promise left without `await`, and a `transaction` called
inside a module (a module saves through its repository).

## Its settings

A context needs to know where to listen and where to keep its data. cooper reads all
of it from environment variables, in one file, with what development needs by
default:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) ? path : join(root, path))

const env = process.env

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens and where its data lives.
 */
export const config = {
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_FOLDER`: the folder of its files, for now (chapter 5 moves it to SQLite). */
    folder: fromRoot(env.COOPER_BOARDS_FOLDER ?? 'data/boards'),
  },
}

export type Config = typeof config
```

Bun loads `.env` on its own, so a `.env` file at the root is enough to change any of
them on your machine. `data/` is in the repository's `.gitignore` already.

Each context takes its own part, and nothing else:

```ts
// cooper/backend/contexts/boards/boards-config.ts
import type { Config } from '../../config'

/** The settings of `boards`, from `config.ts`. */
export type Boards_Config = Config['boards']
```

A context never reads `process.env` itself: it receives its config. That is what lets
a test open it in a folder of its own and on any free port.

## The base: what every module receives

Every module, when it is created, receives the **base** of its context. newt gives you
`Base`, from `newt/runtime`. In it a module finds everything the framework runs it
with: the `store` where its data is kept, the `invocations` of its use cases, the
event `bus`, and the `jobs` of its workers. Its options are a `name` and a `store`
(and a few more, which later chapters use).

Your application extends it with whatever it wants to give its modules. cooper gives
them a router, where each module registers its routes:

```ts
// cooper/backend/shared/cooper-base.ts
import type { FileStore } from 'newt/adapter-files'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'

/**
 * What every module of cooper receives: newt's base, on plain files for now, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<FileStore> {
  readonly http = new HttpRouter()
}
```

- **`Base<FileStore>`** says which store cooper's modules run on. A base can also be
  `Base<Store>`, which says the modules work with **any** store. For now cooper keeps
  plain files; chapter [5](./05-sqlite) changes this one line to SQLite.
- **`HttpRouter`**, from `newt/http`, holds the routes. Every route it is given hangs
  from `/api`, and needs someone signed in unless it says otherwise (next chapter).

Each context can extend the shared base with what only its modules need. `boards`
needs nothing more yet, but it has its own class from the start, so its modules can
say they are `boards`' modules:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { CooperBase } from '../../shared/cooper-base'

/** What every module of `boards` receives: cooper's base. */
export class BoardsBase extends CooperBase {
}
```

## A context that serves itself

newt's `BoundedContext` is a name and a base, with `start()` and `stop()`: `start()`
starts the worker of its jobs, `stop()` waits for the jobs in progress and closes its
store. How it is served is the application's. Every context of cooper serves itself on
a port of its own, and that part is the same for all of them, so it lives in
`shared/`:

```ts
// cooper/backend/shared/served-context.ts
import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain. It answers `GET /api/health` without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** How it is served (`serve`): its modules' API and its health. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, health: true }
  }
}
```

`serving()` does not start a server: it says how one is started. `serve(options)`, from
`newt/http`, turns those options into a `Bun.serve`: every route of the router, and,
with `health: true`, `GET /api/health`, which answers `{ "status": "ok" }` without
anyone signed in (and a 503 once the server is stopping, so a load balancer stops
sending it requests). Whatever a route throws becomes a response there too, as
chapter [3](./03-pages-and-errors) shows.

## The context

A context opens its store, creates its base, initializes its modules and knows how to
serve itself. First, the list of its modules. There are none yet:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'

/** Every module of `boards`, each one after the modules it uses: none yet. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  return {}
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

What it returns is the context's `modules`. From the next chapter on,
`boards.modules.board.create(…)` is how a test, a script or another context calls a
use case. `Boards_Modules` is its type, taken from the function, so it grows with it.

Then the context itself:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { FileStore } from 'newt/adapter-files'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_Modules } from './initialize-modules'

/** The SaaS: each workspace's boards, their columns and cards. */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config): Promise<Boards_Context> {
    const store = await FileStore.open({ folder: config.folder })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config)
    return new Boards_Context(base, modules, config)
  }
}
```

- **The constructor is private.** The only way in is `open`, which is `async` because
  opening a store is.
- **`FileStore.open`**, from `newt/adapter-files`, is the simplest of newt's stores:
  one folder per table, one JSON file per record (`data/boards/board/<id>.json`), and
  transactions through a journal file, one at a time. Nothing to install, and you can
  read what it keeps with `cat`. It is enough for the first chapters; chapter
  [5](./05-sqlite) moves `boards` to SQLite without changing a module.
- **`config` is passed to `super`** as the `ServedContextConfig`: it has a `port`, which
  is all `ServedContext` asks for.

## Start it

The program that runs the backend opens the context, starts its worker and serves it:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'

const boards = await Boards_Context.open(config.boards)
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

For now Ctrl+C stops it as it is. When cooper has a second context, chapter
[17](./17-auth) hands this file to `runContexts`, which also stops them in order.

## Its first test

cooper's tests open the real context and use it as a client would, with no mocks of
the framework. This one opens `boards` in a temporary folder, serves it on a free port
(`port: 0`), asks for its health, and cleans up:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Boards_Context } from './boards.context'

describe('boards, through its API', () => {
  let folder: string
  let boards: Boards_Context
  let server: Server<undefined>

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
    boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
    server = serve(boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await boards.stop()
    await rm(folder, { recursive: true, force: true })
  })

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
```

The order of `afterEach` matters: the server stops taking requests first, then
`boards.stop()` closes the store, then the folder goes.

## Check it

Run the gate:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```
 1 pass
 0 fail
```

Then start the backend:

```sh
bun cooper/backend/index.ts
```

```
boards listening on http://localhost:3002/
```

And, from another terminal, ask it whether it is up:

```sh
curl -s localhost:3002/api/health
```

```json
{"status":"ok"}
```

## What to remember

- cooper's backend is a TypeScript project of its own, apart from newt's, and imports
  newt by its name, through the package's `exports`. Standard decorators: never
  `experimentalDecorators`.
- newt-eslint's preset lints the backend; `contexts.uses` is the shape of the
  application, and grows with every context.
- The base is what every module receives. Extend newt's `Base` with what your modules
  need (cooper: a router), typed with the store they run on.
- A context opens its store, creates its base and initializes its modules. It
  receives its config; it never reads the environment.
- `serve(context.serving())` serves it; `health: true` answers `GET /api/health`
  without a session.

Next: [the first module, boards](./02-first-module).
