# Lint

`newt-eslint` is the lint of an application built with newt: what keeps every module
the same, whoever writes it, and every context inside its borders.

```bash
bun add -d newt-eslint eslint
```

## The preset

`newt(options)` gives the configuration: its rules, the TypeScript parser, and the
files each rule looks at. Its options are `contexts`, the folder of the contexts and
which ones each one uses, and `files`, the globs of the files it lints (every `.ts`
file by default). For an application with two contexts in `src/contexts`,
`auth` and `shop` (which uses `auth`), its `eslint.config.js` could be this (a generic
example; cooper's own is [below](#in-cooper)):

```js
import { newt } from 'newt-eslint'

export default newt({
  contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } },
})
```

A module is a folder in a `modules/` folder, and its context is the folder that holds
`modules/`. That is how `src/contexts/shop/modules/order/` and `app/modules/order/`
are both found. A `modules/` at the project's root has the project itself as its
context.

## In cooper

cooper keeps one `eslint.config.js` at the root of the repository. Its backend takes
newt's preset, with its three contexts: `auth` uses none, `boards` uses `auth`, and
`backoffice` uses both.

```js
// eslint.config.js
import { newt } from 'newt-eslint'

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})

export default [
  { ignores: ['packages/**', 'docs/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  // …
]
```

By default the preset lints every TypeScript file of the repository. `files` keeps it
to the backend and its scripts, since the same file also lints cooper's frontends with
rules of their own (left out here). An application that is only a backend needs no
`files`: `export default newt({ … })` is the whole file.

Run it with `bun run lint` (`eslint`).

## The rules

| Rule | What it says |
|---|---|
| `newt/module-anatomy` | A module is made of the files every module has, named after it: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, its tests, and the folders `events`, `errors`, `value-objects` and `services`. An event's file is `<m>-<event>.ts`. |
| `newt/module-boundaries` | A module imports from another only its module, schema, events, errors and value objects: never its entity, repository, tables, routes or workers, nor its folder (`../board`). |
| `newt/queue-name` | A handler's queue is `<module>.<use case>.on.<module>.<event>`, as the framework requires at startup: in any file of a module, the queue starts with that module, its callback calls that use case on the module itself (`this`, or an object TypeScript says is a `<M>_Module`: `deps.cards` named after it but of another type is not; one of no type it knows, `any`, is not judged; without the program typescript-eslint builds, as the preset does, a name typed `<M>_Module`, or one named after it or its English plural, `cards` for `card`, also as `this.cards` unless the class gives that field another type), and it ends with the event it is subscribed under (`events.assigned` → `….assigned`). A callback that is neither written there nor a function of the file (`cards.notifyAssignee.bind(cards)`) is not looked into. |
| `newt/schema-imports` | A module's schema (`<m>.schema.ts`), which a frontend may import, takes from newt only `newt/contract`: never `newt/core` nor any other entry, which are the server's (they keep scopes on `AsyncLocalStorage` and reach Bun), not even for a type. Only the schema's own imports are checked, not those of the files it imports. |
| `newt/context-boundaries` | With `contexts`: a context imports only the ones `uses` gives it. `uses` lists every context; one naming an unknown context, or a cycle, throws when the preset is built, and a context folder it does not list uses no other. |

In cooper, `queue-name` reads `card.workers.ts` this way: the file is the `card`
module's, the callback calls `cards.notifyAssignee` on a `Card_Module`, and the
emitter is `events.assigned`, so the queue must be
`card.notifyAssignee.on.card.assigned`.

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), {
  strategy: 'handler',
  queue: 'card.notifyAssignee.on.card.assigned',
})
```

A subscription that is no module's, such as a test's own reaction, has no use case to
name. It says so where it is read, with the rule turned off for that line:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.test.ts
// A reaction to boards' cards that fails while the "mail server" is down, at its only attempt.
// It is the test's own, of no module: its queue names none.
let down = true
t.boards.modules.card.events.created.subscribe(() => {
  if (down) throw new Error('the mail server is down')
// eslint-disable-next-line newt/queue-name
}, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
```

Both boundaries read where an import lands, however it is written: `import`,
`export … from`, `import()`, `import x = require()` and `require()`; relative, with an
extension (`./board.module.js`) or not, or an alias of the tsconfig's `paths` (which
the rules read from the program typescript-eslint builds, as the preset does; without
it, only relative imports are checked).

## Besides its own rules

The preset also refuses `transaction` inside a module, called or taken
(`store.transaction(…)`, `store['transaction']`, `const { transaction } = store`): a
module writes through its repository's `save` or `saveRows`. And a promise left
unawaited (`@typescript-eslint/no-floating-promises`, which needs a `tsconfig.json`
that includes every file it lints, or references a project that does: cooper's root
`tsconfig.json` has no files of its own and references one project per part,
`tsconfig.backend.json` for the backend, `tsconfig.newt.json` for the framework).

The rules alone are `plugin`, for a configuration of your own.

::: warning
typescript-eslint does not run on TypeScript 7 yet: install TypeScript 6 as
`typescript`, as the root `package.json` of the repository does:
`"typescript": "npm:@typescript/typescript6@6.0.2"`.
:::
