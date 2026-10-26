# G. The command line

newt comes with a command, `newt`, that sets an application up for coding agents and
writes a module's skeleton. It writes files and imports none of newt's pieces. It
never overwrites a file: what is there already is named and left as it was.

```sh
bunx newt init                                   # in an application's folder
bunx newt add module src/contexts/shop order     # a module's skeleton
bunx newt help
```

Any other command prints that help and exits with 1.

## `newt init`

Run it in an application's folder. It writes three files.

| File | What it holds |
|---|---|
| `AGENTS.md` | The application's own instructions for coding agents (Codex, Cursor, Copilot, Claude Code…): sections to fill in about the project, its contexts, its conventions and its commands. It opens by sending agents to `node_modules/newt/AGENTS.md`. |
| `CLAUDE.md` | Two lines, `@AGENTS.md` and `@node_modules/newt/AGENTS.md` (or the path where newt's file was found): Claude Code imports both files into its memory. |
| `eslint.config.js` | newt's lint (`newt()` from `newt-eslint`), only if there is no ESLint configuration in this folder or any folder above. |

`node_modules/newt/AGENTS.md` is newt's own: the rules of the framework, the anatomy
of a module, a snippet of each piece, what to do about each error newt throws, the
lint's rules, the commands and a definition of "done". It ships with the package, so it
always describes the version installed: updating newt updates it. The application's
`AGENTS.md` says only what is the application's own.

Both files are looked for in the folder and in the folders above, as Bun installs and
as ESLint looks for its configuration. An application inside a monorepo points at the
root's `node_modules`, and keeps the root's lint: `newt init` says which configuration
it found and that newt's preset goes into it.

It ends by printing what is left to do: install newt and its lint, fill in `AGENTS.md`,
and add the first module. In a new folder:

```text
wrote    AGENTS.md
wrote    CLAUDE.md
wrote    eslint.config.js

Next:
  bun add newt zod
  bun add -d newt-eslint eslint typescript@npm:@typescript/typescript6@6.0.2
  fill in AGENTS.md: the project, its contexts, its conventions
  newt add module <context-folder> <module>   e.g. newt add module src/contexts/shop order
```

Run again, it writes nothing: `skipped  AGENTS.md (it is there already: left as it
was)`, and the same for the others. cooper sits in a monorepo whose root has the lint,
so in `cooper/` it writes the first two and leaves the third to the root
([chapter 1](./01-project-and-context)):

```text
skipped  eslint.config.js (../eslint.config.js is there: add newt-eslint's preset to it, `newt()`)
```

and cooper's `CLAUDE.md` imports `@../node_modules/newt/AGENTS.md`.

## `newt add module <context-folder> <name>`

Writes the skeleton of a module in `<context-folder>/modules/<name>/`, with the
anatomy and the names newt's lint asks for. `<name>` is kebab-case: `price-change`
gives `PriceChange_Module`, the use cases' prefix `priceChange`, the table
`price_change` and the routes `/price-changes`.

| File | What it holds |
|---|---|
| `<name>.schema.ts` | The module's contract with zod: the entity and what a client sends. |
| `<name>.ts` | The entity. |
| `<name>.repository.ts` | Its repository, with `scope: 'none'` and a note: decide it, a tenant's scope or none and why. |
| `<name>.module.ts` | The module, with two use cases, `create` and `get`. |
| `<name>.deps.ts` | The modules it uses, empty. |
| `<name>.routes.ts` | Its routes, passing the body to the use case as it came. |
| `events/<name>-created.ts` | The event `create` tells. |
| `errors/<name>-not-found.ts` | The error `get` throws. |
| `<name>.test.ts` | Its tests, on a store of files. |

The skeleton compiles, passes the lint and its own tests. What it does not know is yours
to finish: the scope of its repository, a migration for its table, and its place in the
context's `initialize-modules.ts`. The command prints those steps:

```text
wrote    src/contexts/shop/modules/price-change/price-change.schema.ts
wrote    src/contexts/shop/modules/price-change/price-change.ts
wrote    src/contexts/shop/modules/price-change/price-change.repository.ts
wrote    src/contexts/shop/modules/price-change/price-change.module.ts
wrote    src/contexts/shop/modules/price-change/price-change.deps.ts
wrote    src/contexts/shop/modules/price-change/price-change.routes.ts
wrote    src/contexts/shop/modules/price-change/events/price-change-created.ts
wrote    src/contexts/shop/modules/price-change/errors/price-change-not-found.ts
wrote    src/contexts/shop/modules/price-change/price-change.test.ts

Next:
  decide the scope in src/contexts/shop/modules/price-change/price-change.repository.ts: a tenant's { field, current }, or 'none' with the reason
  add a migration for the table 'price_change' in each dialect's migrations folder (FileStore needs none)
  initialize PriceChange_Module in the context, after the modules it uses, with its deps
  bun check && bun test && bunx eslint
```

A name that is not kebab-case is refused, with exit code 1: `'Price' is not a module's
folder name: lower-case words in kebab case, as price-change`. A file already there is
skipped, as `newt init` does.

In the tutorial, cooper's modules are typed by hand, file by file, to explain each one;
[chapter 6](./06-rules-over-rows) points out where the command would have written the
skeleton.

## newt-graph

`newt-graph` (in `packages/newt-graph`) draws a newt application, read from its code
with TypeScript's checker, as the editor reads it: no annotations, no AI. Its contexts
hold their modules, which hold their use cases, events and routes; the edges are the
calls between use cases, the events each one tells, the subscriptions and schedules
that wake workers, and the routes that reach them.

```sh
bun run cooper:graph                 # cooper, in this repository
bunx newt-graph                      # serves the page on http://localhost:4747 and opens it
bunx newt-graph --out graph.html     # one self-contained file: no server, no network
bunx newt-graph --json               # the model, as JSON
```

Each reload of the served page reads the code again. `--root` names the backend's folder
(by default, the one above newt-eslint's `contexts.folder`), and `--tests` adds the tests
and fakes, marked as such.

On the page:

- **How much is drawn**: `1` contexts, `2` modules, `3` use cases, `4` events as nodes
  too. A double click (or `x`) opens or closes one context or module in place.
- **Search** (`/`), fuzzy; **filters** by context, by kind of edge, and only what touches
  the selection (`s`); **marks** (`m`), kept in the browser.
- **Side effects** (`e`): what a use case sets going, animated: the request's calls
  first, then each worker hop as a later wave, in any context. The side panel has it as
  a tree: a call, an event told after its save commits, a job (whose outbox, its queue,
  its `when`).
- **Who can cause it** (`u`): the same chain the other way, the farthest cause first.
- **Dependencies** (`d`): modules with their calls, events and declared deps, and the
  contexts' `uses`; an edge into a context not used is red.
- **Details**: click anything for its `file:line`, with a `vscode://` link that opens it.

What reading the code cannot tell: a value chosen at run time counts as every module it
may be; an event told on one branch of an `if` is drawn as told, and a `when` is shown,
not evaluated; calls through a `Map`, `any`, `bind`, or a class behind an interface (the
search, the mailer) are not followed; entry points other than newt's router (an MCP
server's tools) show only where they go through a route; a name made at run time is not
known. newt-graph's own tests open cooper and check that every queue and schedule it
registers is in the graph.
