# newt-graph

Draws a newt application, read from its code: its contexts, the modules in each, their
use cases and events, and how they reach each other. Pick a use case and watch
everything it sets going, animated: the use cases it calls now, the events it tells,
the workers those wake in any context, what they call and tell in turn, wave after
wave. Or the other way: whatever can cause it.

```sh
bun add -d newt-graph        # typescript too, if the application does not have it
bunx newt-graph              # reads the application, serves the page and opens it
```

No annotations and no AI: it reads the code with TypeScript's compiler, as the
editor does.

## Running it

```
newt-graph [--root <dir>] [--tsconfig <file>] [--config <file>]
           [--json] [--out <file>] [--open | --no-open] [--port <n>] [--tests]
```

| Option | What it does |
|---|---|
| (none) | Serves the page on `http://localhost:4747` and opens it. Each reload reads the code again. |
| `--out graph.html` | Writes the page, whole, to one file: its script (Cytoscape in it), its style and the graph. It needs no network and no server; send it, open it. `--open` opens it. |
| `--json` | Prints the graph ([below](#the-graph-as-json)); with `--out`, writes it there. |
| `--root <dir>` | The backend's folder. By default the folder above newt-eslint's `contexts.folder` (read from `eslint.config.js`), else the current one. |
| `--tsconfig <file>` | The tsconfig that compiles it. By default the nearest `tsconfig.json` above the root; a solution (`"files": []` with `references`) is followed to the projects that hold files under the root. |
| `--tests` | Reads `*.test.ts`, `*.spec.ts` and the files under `testing/`, `test/`, `fixtures/` too. Their modules and subscriptions are marked `test`, and the page hides them unless asked. |
| `--port <n>` | Where it serves (`0` for any free port). |

In this repository, `bun run cooper:graph` draws cooper.

A config file is optional, `newt-graph.config.{ts,js,json}` where it runs (or
`--config`); its paths are its own folder's:

```ts
// newt-graph.config.ts
export default {
  root: 'src',
  tsconfig: 'tsconfig.json',
  // Which contexts may use which: read from newt-eslint's `contexts.uses` when not given.
  uses: { auth: [], shop: ['auth'] },
  name: 'shop',
}
```

## How it reads an application

Everything comes from the code, through TypeScript's type checker, following the
conventions newt's rules ask for:

- **A context** is a `new <Base or a subclass>({ name: 'boards', … })`.
- **A module** is a class that extends `Module`, named by its `super('card', …)`, and is
  in the context of the `Base` its `X_Module.initialize(base, …)` is given (followed
  through the functions it is passed to, `initializeModules(base)`; the folder
  `contexts/<name>/` when that cannot be followed). A module class initialized in two
  contexts (cooper's `WebSession_Module`, `Outbox_Module`) is two modules.
- **Its deps** are the `deps` argument of its `initialize`: each one a module, or a port
  (a type in the module's own words), with the module behind the port when it can tell
  (`tenants: tenant.events` is auth's tenant). Where its deps type says each one is the
  location given.
- **A use case** is a method with `@UseCase(…)`, with its `writesTo` and `retryOnConflict`.
- **What a use case does** is read from its body, and the bodies of whatever it calls
  that is no use case: private methods, the entity's methods, the repository's,
  functions, the functions a port or an option is given (`identify: token =>
  auth.token.verify(token)`). A call to another use case is a `calls` edge: through
  `this`, `this.deps.x`, a port (`Workspaces.isMember` in `via`), whatever value it is
  followed to. A `new` of an event class (a class with a static `eventName`) is an
  `emits` edge, wherever it is made on the way: `card.create` → `Card.create` →
  `new Card_Created(…)`.
- **An event** is told by the module whose `eventsOf` offers its class (else the module of
  its folder); **a schedule** is a `base.schedules.define('session.nightly', cron)`.
- **A subscription** is a `.subscribe(callback, { strategy, queue, attempts, when })` on an
  event's emitter. Its event is the one its queue names (`….on.card.created`, which the
  framework itself checks), or for a `fire-and-forget`, the emitter followed to its
  class. The use cases its callback calls are its handlers (`triggers` edges). Its jobs
  are in the outbox of the context that tells the event, and that context's worker
  runs them (`runsIn`), whichever context reacts.
- **A route** is a `get`, `post`, `put`, `patch` or `delete` of `newt/http`'s router or
  group, with the router's prefix (`/api` unless it says) and its groups'
  (`base.http.group('/workspaces/:workspaceId', …)`), and the use cases its handler and
  its groups' middleware call.

### Why from the code, and not from the application running

Opening the contexts as the tests do, without serving them, tells some of it for
sure: the `handler` subscriptions each context's job queue registers, and its
schedules. But not the rest: the `fire-and-forget` ones live in a closure no one can
reach, a use case is known only once it is called, nothing says which use case calls
which or which events a use case tells, and nothing has a file and a line. Opening them
also needs each application's configuration and stores. So the graph is read from the
code, and the running application checks it: newt-graph's own tests open cooper in
memory and compare every queue and schedule it registers with what the code says
(`test/cooper.test.ts`, *agrees with cooper running*). An application can do the same.

## The page

- **Nested**: contexts hold modules, which hold use cases (and events, and routes). Each
  context has its colour; each of its modules a shade of it.
- **How much is drawn**: `1` contexts only, `2` modules, `3` use cases, `4` with events as
  nodes. Edges are added up between what is drawn (the number on an edge). A double
  click (or `x`) opens or closes one context or module in place.
- **Search** (`/`): fuzzy, over contexts, modules, use cases, events and routes; the one
  picked is opened, selected and centred.
- **Filters**: by context; by edge kind (calls, events and their workers, schedules,
  writesTo, routes, declared deps); tests and fakes (with `--tests`); only what touches
  the selection (`s`).
- **Marks** (`m`): kept in the browser (localStorage), listed on the side, shown alone with
  *Only these*.
- **Side effects** (`e`): the chain of a use case (or a route, an event, a module),
  animated: dots travel along the edges, the request's calls first, then each worker hop
  as a later wave, each wave in its colour. The side panel has it as a tree: a call
  (now, same request), an event told (after its save commits), a job (whose outbox,
  its queue, its attempts, its `when`) or a fire-and-forget (in memory), a `writesTo`.
  Play, pause (`space`), step (`→` `←`), replay (`r`), speed, and only the chain or
  everything around it (`i`).
- **Who can cause it** (`u`): the chain the other way, the farthest cause first.
- **Dependencies** (`d`): modules, with their direct dependencies (calls, solid), the
  indirect ones (events, dashed), their declared deps (dotted), and the contexts'
  `uses` from newt-eslint (green). An edge that crosses into a context its context does
  not say it uses is red.
- **Details**: click anything for what it is, where (`file:line`, a `vscode://` link
  that opens it in the editor), and what it calls, tells, runs on and is called by.
  Click an edge for what it is made of.
- Light and dark (`t`), as the system says until told.

## The graph as JSON

`newt-graph --json` prints `Graph` (`src/model.ts`, whose comments are the reference).
`version` is `1`; fields are only ever added. Every `file` is relative to `app.base`,
every `line` 1-based.

| Field | Each one |
|---|---|
| `app` | `name`, `base` (absolute), `root`, `tsconfig`, `generatedAt`, `tests` |
| `contexts` | `id` (its name), `name`, `uses` (newt-eslint's, or null), `file`, `line` |
| `modules` | `id` (`boards/card`), `context`, `name`, `className`, `initializedAt`, `test`, `deps` (`name`, `kind`: module or port, `target`: a module id or null, `file`, `line`) |
| `useCases` | `id` (`boards/card.create`), `module`, `context`, `name`, `writesTo`, `retryOnConflict` |
| `events` | `id` (`boards/card.created`), `name`, `module`, `context`, `className`, `schedule` (`{ cron }` or null) |
| `subscriptions` | `id`, `event`, `module`, `context` (who reacts), `handlers` (use case ids), `strategy` (`handler` or `fire-and-forget`), `queue`, `attempts`, `filtered` (has `when`), `runsIn` (whose outbox and worker), `test` |
| `routes` | `id`, `method`, `path` (prefixes included), `module`, `context`, `useCases` |
| `edges` | `id`, `kind`, `from`, `to`, `async`, `via`, `strategy`, `file`, `line` |
| `warnings` | `message`, `file`, `line`: what it could not settle |

Edge kinds, ids in `from` → `to`:

| `kind` | From → to | |
|---|---|---|
| `calls` | use case → use case | now, in the same request; `via` the port member it went through |
| `emits` | use case → event | at the `new` of the event |
| `triggers` | event → use case | `async`; `via` the subscription, `strategy` handler or fire-and-forget |
| `writesTo` | use case → module | its `@UseCase({ writesTo })` |
| `routes` | route → use case | |
| `depends` | module → module | what it is given at `initialize`; `via` the port's name |

## What reading the code cannot tell

- **A value chosen at run time** counts as every module it may be: `outboxes[name].retry()`
  calls each context's `outbox.retry`. A receiver it cannot follow at all is the module
  of its type, in the caller's context when there is one there.
- **What may not happen**: an event a use case tells on one branch of an `if` is drawn as
  told; a `when` is shown (`filtered`), not evaluated.
- **Calls through what it cannot follow**: a function kept in a `Map`, passed through
  `any`, built at run time, or a class behind an interface (the search, the mailer) are
  not followed; nor are `bind`, `call` and `apply`.
- **Subscriptions** must be written as newt writes them, `.subscribe(callback, { … })`
  with the options in place; a fire-and-forget whose emitter cannot be followed to its
  event is left out, with a warning.
- **Routes** are newt's router's; other entry points (an MCP server's tools, a CLI) show
  only where they go through a route (cooper's `POST /mcp` reaches what its tools call).
- **Schedules and events** are known by the code that defines them; one published under a
  name made at run time is not.

## Why Cytoscape

Compared for nesting context ⊃ module ⊃ use case, animating, and staying simple:

| Library | Nesting | Fit |
|---|---|---|
| **Cytoscape.js** + fcose | compound nodes, any depth, laid out together | chosen: one dependency (plus its layout), animations of positions and styles, no framework |
| React Flow + ELK | sub-flows; ELK lays out hierarchies well | a React toolchain to build the page, and ELK's worker |
| Sigma.js | none (WebGL, flat) | for very large flat graphs |
| D3-force | none: groups by hand | everything by hand |
| vis-network | clusters, one level, not drawn as boxes | nested views would be faked |

The page is bundled with `bun build` into the HTML it writes (or serves): no CDN, no
network, nothing to install in the browser.
