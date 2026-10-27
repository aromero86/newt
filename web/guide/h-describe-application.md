# H. What an application knows of itself

newt-graph ([appendix G](./g-command-line#newt-graph)) reads an application from its
code. The application can say much of the same of itself, while it runs: its contexts
and the ones each uses, the modules of each, their use cases, the events they tell
(schedules among them), what each module depends on, and who reacts to which event.
That is **`describeApplication`**, from `newt/runtime`.

It asks one thing of each module, which the chapters' modules do not do yet: to pass
its deps to `super`. This appendix shows that change, then what the description holds.

## What each context registers

Each context's base keeps a **registry**, in its `invocations`. As the context opens,
every piece tells it what it is:

- **A module**, as it is built: `super(…)` registers its name, its class and its deps.
- **Each `@UseCase`** of it, with its `writesTo` and `retryOnConflict`
  ([chapter 8](./08-two-people-one-card), [14](./14-sagas)).
- **Each schedule**, as `base.schedules.define` defines it, with its cron
  ([chapter 19](./19-invitations-and-time)).
- **Each subscription**, as it is made: its event, its strategy, and for a handler its
  queue, its attempts and whether it says `when` ([chapter 11](./11-reacting)).

Nothing is read from the code: the registry holds what was built, and nothing else.
You never call it. `describeApplication` reads it.

## A module passes its deps to `super`

The chapters' modules call `super('board', base.invocations)`: newt knew a module by
its name. To know what it depends on, `Module`'s constructor takes a third argument,
the deps its `initialize` was given. `member` keeps its deps, and passes them on:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
  static initialize(base: BoardsBase, deps: Member_Deps): Member_Module {
    return new Member_Module(base, deps)
  }

  private constructor(base: BoardsBase, private readonly deps: Member_Deps) {
    super('member', base.invocations, deps)
  }
```

`board`'s deps are only for its routes (`member`, which runs them in the workspace
scope, [chapter 4](./04-who-and-where)). Its constructor takes them all the same, just
to pass them on:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  static initialize(base: BoardsBase, deps: Board_Deps): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base), deps)
    registerBoardRoutes(base, module, deps)
    return module
  }

  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository, deps: Board_Deps) {
    super('board', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }
```

- **All of its deps**, those only its routes or workers use too: `activity` and the
  backoffice's `metric` take theirs the same way. What a module is configured with,
  its `<M>_Options` (a mailer, a URL), is not a dep, and is not passed.
- **The module keeps none of them there.** `super` hands them to the registry, which
  only looks at them.
- **A module that passes none still works.** The description says it depends on
  nothing, which is wrong, and nothing tells you. Every module of cooper passes its
  deps, and `bunx newt add module` writes the skeleton that way
  ([appendix G](./g-command-line)).

## `describeApplication`

`describeApplication(contexts)` takes the opened contexts (or their bases) and returns
an **`ApplicationDescription`**. A script of your own at the repository's root, beside
`cooper/`, that opens cooper's contexts in memory and asks:

```ts
// describe-cooper.ts
import { describeApplication } from 'newt/runtime'
import { config } from './cooper/backend/config'
import { openContexts, stopContexts } from './cooper/backend/open-contexts'

const contexts = await openContexts({
  ...config,
  auth: { ...config.auth, database: ':memory:' },
  boards: { ...config.boards, database: ':memory:' },
  backoffice: { ...config.backoffice, database: ':memory:' },
})
const application = describeApplication([...contexts.all])
for (const context of application.contexts) {
  console.log(`${context.name} uses [${context.uses.join(', ')}]: ${context.modules.length} modules, ${context.subscriptions.length} subscriptions`)
}
console.log(JSON.stringify(application.contexts[1]!.modules.find(module => module.name === 'board'), null, 2))
await stopContexts(contexts)
```

```sh
bun describe-cooper.ts
```

```text
auth uses []: 10 modules, 12 subscriptions
boards uses [auth]: 8 modules, 21 subscriptions
backoffice uses [auth, boards]: 7 modules, 0 subscriptions
{
  "id": "boards/board",
  "context": "boards",
  "name": "board",
  "className": "Board_Module",
  "useCases": [
    { "id": "boards/board.list", "name": "board.list", "writesTo": [], "retryOnConflict": true },
    …
    { "id": "boards/board.purgeWorkspace", "name": "board.purgeWorkspace", "writesTo": [], "retryOnConflict": true }
  ],
  "events": [
    { "id": "boards/board.created", "name": "board.created", "schedule": null },
    { "id": "boards/board.updated", "name": "board.updated", "schedule": null },
    { "id": "boards/board.archived", "name": "board.archived", "schedule": null }
  ],
  "deps": [
    { "name": "member", "kind": "module", "target": "boards/member" }
  ]
}
```

The `uses` are the ones `eslint.config.js` says (auth none, boards auth, the
backoffice both, [chapter 20](./20-wiring-contexts)), found from the modules' deps. The
backoffice has no subscriptions: its `metric` reacts to events of auth and of boards,
and each of those subscriptions is the event's context's, since its jobs are in that
context's outbox ([chapter 26](./26-dead-jobs-and-analytics)).

## What it holds

| Type | What it is |
|---|---|
| `ApplicationDescription` | `{ version: 1, contexts }`. A field is only ever added; `version` goes up when one changes meaning. |
| `ContextDescription` | A context: its `name`, the contexts it `uses`, its `modules` and the `subscriptions` to its events. |
| `ModuleDescription` | A module: its `id`, `context`, `name`, `className`, `useCases`, `events` and `deps`. |
| `UseCaseDescription` | A use case: its `id`, its `name` (`card.create`), its `writesTo` and `retryOnConflict`. |
| `EventDescription` | An event a module tells: its `id`, its `name`, and its `schedule` (`{ cron }`), null for one that is not. |
| `ModuleDependency` | One of a module's deps, by its key: a `module`, the `events` of one, or a `port`. |
| `SubscriptionDescription` | A subscription: its `event`, its `strategy`, and for a handler its `queue`, the use case it names (`handler`), its `attempts` and whether it is `filtered` by a `when`. |

The ids are newt-graph's: a module's is `boards/card`, a use case's
`boards/card.create`, an event's `boards/card.created`. Against cooper, the two agree.

A dep is one of three kinds:

- **`module`**: another module, of its context or another. `card`'s `board`,
  `column` and `member`, and auth's access module, `{ name: 'auth.access', kind:
  'module', target: 'auth/access' }`.
- **`events`**: the events of a module handed alone (`orders: order.events`), as a
  worker subscribes to them: `{ kind: 'events', target: 'shop/order', events:
  ['order.placed'] }`. cooper hands the modules themselves, so it has none.
- **`port`**: anything else, an object in the module's own words: a mailer, a search,
  a payment provider. Whose it is the description cannot tell, so its `target` is
  null. That is why another context's modules are handed as they are, never wrapped
  in a port of functions ([chapter 20](./20-wiring-contexts)): wrapped, the
  dependency would be a port with no target.

An object of deps is looked into, its keys joined: boards' `member` depends on
`auth.access`, `auth.tenant` and `auth.user`.

## What it cannot tell

- **Calls and routes.** It knows what a module depends on, not which use case calls
  which, nor its routes. Those are newt-graph's, read from the code.
- **A module that passed no deps**, as said above.
- **A port's module.**

And the other way round, newt-graph cannot tell what is chosen as the application
runs; the description is what was built. One reads the code, the other the running
application: a page, a health check or a test can ask the second without reading a
line of the first.
