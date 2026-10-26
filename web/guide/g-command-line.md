# The command line

newt comes with a command, `newt`, that sets an application up for coding agents and
writes a module's skeleton. It writes files and imports none of newt's pieces. It
never overwrites a file: what is there already is named and left as it was.

```sh
bunx newt init                                   # in an application's folder
bunx newt add module src/contexts/shop order     # a module's skeleton
bunx newt help
```

## `newt init`

Run it in an application's folder. It writes three files.

| File | What it holds |
|---|---|
| `AGENTS.md` | The application's own instructions for coding agents (Codex, Cursor, Copilot, Claude Code…): sections to fill in about the project, its contexts, its conventions and its commands. Its first line sends agents to `node_modules/newt/AGENTS.md`. |
| `CLAUDE.md` | Two lines, `@AGENTS.md` and `@node_modules/newt/AGENTS.md`: Claude Code imports both files into its memory. |
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
and add the first module.

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
context's `initialize-modules.ts`. The command prints those steps.
