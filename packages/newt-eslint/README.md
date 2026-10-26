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
})
```

A module is a folder in a `modules/` folder, and its context is the folder that holds
`modules/`. That is how `src/contexts/shop/modules/order/` and `examples/despensa/modules/order/` are both found.

| Rule | What it says |
|---|---|
| `newt/module-anatomy` | A module is made of the files every module has, named after it: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, its tests, and the folders `events`, `errors`, `value-objects` and `services`. |
| `newt/module-boundaries` | A module imports from another only its module, schema, events, errors and value objects: never its entity, repository, tables, routes or workers. |
| `newt/queue-name` | A handler's queue is `<module>.<use case>.on.<event>`: the module of the workers file, a use case its callback calls, and the event it subscribes to. |

The preset also refuses `transaction(…)` inside a module (it writes through its
repository's `save` or `saveRows`), and a promise left unawaited
(`@typescript-eslint/no-floating-promises`, which needs a `tsconfig.json` that
includes every file it lints).

The rules alone are `plugin`, for a configuration of your own.

typescript-eslint does not run on TypeScript 7 yet: install TypeScript 6 as
`typescript`, for instance as `"typescript": "npm:@typescript/typescript6@6.0.2"`.
