# @newt-kit/eslint

The lint of an application built with newt: what keeps every module the same,
whoever writes it.

```bash
bun add -d @newt-kit/eslint eslint
```

```js
// eslint.config.js
import { newt } from '@newt-kit/eslint'

export default newt({
  // Optional: the folder of the contexts, and which ones each one uses.
  contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } },
  // Optional: the files it lints; every .ts file by default.
  files: ['src/**/*.ts'],
})
```

A module is a folder in a `modules/` folder, and its context is the folder that holds
`modules/`. That is how `src/contexts/shop/modules/order/` and `app/modules/order/` are both found.
A `modules/` at the project's root has the project itself as its context.

| Rule | What it says |
|---|---|
| `newt/module-anatomy` | A module is made of the files every module has, named after it: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, its tests, and the folders `events`, `errors`, `value-objects` and `services`. |
| `newt/module-boundaries` | A module imports from another only its module, schema, events, errors and value objects: never its entity, repository, tables, routes or workers, nor its folder (`../product`). |
| `newt/queue-name` | A handler's queue is `<module>.<use case>.on.<module>.<event>`, as the framework requires at startup: in any file of a module, the queue starts with that module, its callback calls that use case on the module itself (`this`, or an object TypeScript says is a `<M>_Module`: `deps.categories` named after it but of another type is not; one of no type it knows, `any`, is not judged; without the program typescript-eslint builds, as the preset does, a name typed `<M>_Module`, or one named after it or its English plural, `categories` for `category`, also as `this.categories` unless the class gives that field another type), and it ends with the event it is subscribed under (`events.confirmed` → `….confirmed`). A callback that is neither written there nor a function of the file (`orders.fulfil.bind(orders)`) is not looked into. |
| `newt/schema-imports` | A module's schema (`<m>.schema.ts`), which a frontend may import, takes from newt only `@newt-kit/newt/contract`: never `@newt-kit/newt/core` nor any other entry, which are the server's, not even for a type. Only the schema's own imports are checked, not those of the files it imports. |
| `newt/use-case` | Every public method of a module is a use case: in a `*.module.ts`, a class extending `Module` marks each method it offers (not `private`, `protected` or `static`, nor the constructor or a getter) with `@UseCase`. One left unmarked would run outside the write rule, the retry on a conflict and the trace: mark it, or make it `private`. A function in a public field is refused too. It reads every `*.module.ts` wherever it is. |
| `newt/route-body` | A route passes a body to a use case as it came: in a `*.routes.ts`, `await request.json() as X` (or `<X>…`, or `const body: X = await request.json()`) is refused, since it says the body is an `X` before anything checked it. The use case takes it as `unknown` and parses it with its input schema; `as unknown`, or a schema's `parse` in the route, is fine. It reads every `*.routes.ts` wherever it is. |
| `newt/context-boundaries` | With `contexts`: a context imports only the ones `uses` gives it. `uses` lists every context; one naming an unknown context, or a cycle, throws when the preset is built, and a context folder it does not list uses no other. |

Both boundaries read where an import lands, however it is written: `import`,
`export … from`, `import()`, `import x = require()` and `require()`; relative, with
an extension (`./product.module.js`) or not, or an alias of the tsconfig's `paths`
(which the rules read from the program typescript-eslint builds, as the preset does;
without it, only relative imports are checked).

The preset also refuses `transaction` inside a module, called or taken
(`store.transaction(…)`, `store['transaction']`, `const { transaction } = store`): it
writes through its repository's `save` or `saveRows`. And a promise left unawaited
(`@typescript-eslint/no-floating-promises`, which needs a `tsconfig.json` that
includes every file it lints).

The rules alone are `plugin`, for a configuration of your own.

typescript-eslint does not run on TypeScript 7 yet, so this package brings its own
TypeScript 6 for it: the application keeps whichever TypeScript it has, 7 as `bun init`
adds it too. A config of your own parses with the same one through `parser`.
