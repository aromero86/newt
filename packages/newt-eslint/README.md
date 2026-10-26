# newt-eslint

The lint of an application built with newt: what keeps every module the same,
whoever writes it.

```bash
bun add -d newt-eslint eslint
```

```js
// eslint.config.js
import { newt } from 'newt-eslint'

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

typescript-eslint does not run on TypeScript 7 yet: install TypeScript 6 as
`typescript`, for instance as `"typescript": "npm:@typescript/typescript6@6.0.2"`.
