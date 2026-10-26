# B. A module's anatomy

Every module of cooper has the same files, named after it, so whoever opens one knows
where everything is. A module is a folder in its context's `modules/`, in kebab case:
`cooper/backend/contexts/<context>/modules/<module>/`.

## The files

| File | What it holds |
|---|---|
| `<m>.schema.ts` | The zod schemas, the DTO types and the filters: the module's **public contract**. Other modules, other contexts and the API clients import it. |
| `<m>.ts` | The entity, a class extending `Entity`. It re-exports the schema. |
| `<m>.repository.ts` | The only file that touches the store. |
| `<m>.module.ts` | `<M>_Module`: its use cases and its `events` (`eventsOf(base.bus, { … })`), and `static initialize`. |
| `<m>.routes.ts` | Its routes, if it has any. |
| `<m>.workers.ts` | Its reactions to events (`deps.<module>.events.<event>.subscribe(…)`), if it has any. |
| `<m>.deps.ts` | `<M>_Deps`: the modules it knows, and the ports it needs from outside its context, imported as types. |
| `<m>-options.ts` | `<M>_Options`: what its context configures it with (a mailer, a URL, a number of days). |
| `events/<m>-<verb>.ts` | One event per file. |
| `errors/<error>.ts` | One error per file. |
| `value-objects/<name>.ts` | Its value objects, if it has any. |
| `services/<name>.ts` | Logic its use cases share, one file each. |
| `*.test.ts` | Its tests, beside what they test. |

Only `<m>.module.ts` is always there. boards' `card` has almost all of them:

```
cooper/backend/contexts/boards/modules/card/
  card.schema.ts       CardSchema, CardFilter, CardDTO…
  card.ts              Card, the entity
  card.repository.ts   persistNew, persistOrder, search, countByWorkspace…
  card.module.ts       Card_Module: create, move, assign, search…
  card.routes.ts       under /workspaces/:workspaceId
  card.workers.ts      notify the assignee; unassign a member who left
  card.deps.ts         board, column, member, and auth's access events
  card-options.ts      the mailer, boards' public URL
  card.test.ts
  events/              card-created.ts, card-moved.ts, card-assigned.ts…
  errors/              card-not-found.ts, column-not-empty.ts…
```

And the backoffice's `workspace` keeps nothing, so it has no entity and no repository:
a module, its deps, its routes, its schema, its test.

## What the lint checks

cooper's `eslint.config.js` applies `newt-eslint`'s preset to the backend and the
scripts, with its contexts:

```js
// eslint.config.js
const BACKEND = newt({
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
```

In every file under a `modules/<module>/` folder:

- **`newt/module-anatomy`**: only the files and folders of the table above, named
  after the module; an event's file starts with the module's name.
- **`newt/module-boundaries`**: a module imports from another only its module,
  schema, events, errors and value objects. Never its entity, repository, routes or
  workers, nor its folder.
- **`newt/queue-name`**: a handler's queue is `<module>.<use case>.on.<module>.<event>`,
  starts with the module that reacts, and its callback calls that use case.
- **No transaction of its own**: `transaction`, called or taken, is refused. A module
  writes through its repository's `save` or `saveRows`.

Everywhere in the backend:

- **`@typescript-eslint/no-floating-promises`**: no promise left without `await`.
- **`newt/context-boundaries`**: a context imports only the contexts `uses` gives it.
  boards may import auth, auth imports neither. The preset refuses a `uses` with a
  cycle.

```bash
bun run lint
```

## Names

For a module about OAuth grants, as auth has it:

| What | Name |
|---|---|
| Folder | `oauth-grant` |
| Module class | `OauthGrant_Module` |
| Module name (`super('…')`) | `oauthGrant` |
| Entity | `OauthGrant` |
| Repository | `OauthGrant_Repository` |
| Table | `oauth_grant` |
| Use case | `oauthGrant.redeem` |
| Event | `oauthGrant.replayed`, class `OauthGrant_Replayed`, file `events/oauth-grant-replayed.ts` |
| Error | `errors/invalid-grant.ts`, code `oauthGrant.invalid_grant` |
| A worker's queue | `token.revokeGrant.on.oauthGrant.replayed` |

The queue names who reacts (`token`), with what (`revokeGrant`), to which event
(`oauthGrant.replayed`). Renaming any of the three renames the queue, and leaves the
jobs already waiting under the old name ([chapter 11](./11-reacting)).

A context has a few files of its own beside `modules/`: `<context>.context.ts` (opens
it), `initialize-modules.ts` (each module after those it uses), its base and its config
type, `migrations/` and `testing/`.
