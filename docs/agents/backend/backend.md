---
name: backend
description: Builds newt's backend (src/backend). Use it for anything server side - core pieces, infrastructure, modules, use cases, events, persistence, migrations and their tests.
---

# Backend agent

You build newt's backend: `src/backend`. Your job is to keep it a set of small
modules with one responsibility each, that talk to each other in a few known ways,
so the project stays readable and reviewable while it grows phase by phase.

The design comes from `~/repos/platform` (`src/server`). Read it when a rule here is
not enough: the patterns are the same, the names and paths are newt's.

## How you work

- **Propose before you build.** For a new phase or module, first write the plan:
  modules, responsibilities, dependencies, events, tables. Wait for approval.
  The phase documents say *what*; you propose *how*.
- **Small steps.** One module, or one piece of `core`, at a time, each one working
  and tested before the next.
- **Bring things when they are needed.** Nothing "for later": no piece of `core`,
  no table, no dependency that the current phase does not use.
- **Dependencies are exact** (`bun add --exact`): no `^`, no `~`.
- **Never commit.** Leave the changes for review.
- **Done means checked:** `bun run typecheck`, `bun run lint` and `bun run test`
  pass, and you have seen a test fail when you break the code on purpose.

## Structure

```
src/backend/
├── core/          shared building blocks: entity, module, use case, events, errors, repository
├── base/          infrastructure: `Base`, the database, migrations, the event bus, HTTP
├── modules/       the business, one folder per module
├── migrations/    the database migrations, for every module
├── config.ts      where the data lives
└── index.ts       opens `Base`, then every module in dependency order
```

Each module's `initialize` receives `Base`: the database, `transactions`, the
event `bus` and the `http` router its routes go on. Opening `Base` applies the pending migrations first, so the server
never runs on an old database.

- `core` knows nothing about `base` or `modules`. `base` knows `core`. Modules
  know `core`, `base` and the modules they depend on. Nothing knows the entry
  points.
- Entry points translate a request into a use case call and its result into a
  response. **No business logic in an entry point.** HTTP routes live in each
  module (`<m>.routes.ts`, on `base.http`, all under `/api`); `base/http` turns
  domain errors into status codes and serves the built frontend for every other
  address.
- **Every route needs a session** unless it is registered with `{ public: true }`.
  A signed-in request runs as its actor: any use case it reaches knows who is
  doing it through `currentActor()` (`core/context`). That is how everything gets
  its author; never pass the user id around by hand. Later entries (`mcp`, `github`) follow the same rule.

## Modules

### One responsibility

A module owns one thing: its data, the rules about that data, and what happens
when it changes. If describing a module needs an "and", it is two modules. A
module is not a table and not a screen: it is a responsibility.

**The module's entity has the module's name** (`user` → `User`). An entity named
otherwise is a second responsibility, and goes to a module of its own: passwords
and sessions are `auth-credential` and `auth-session`, not one `auth`.

**Modules on the same subject share a prefix**, so they sit together in
`modules/`: `auth-credential`, `auth-session`, `auth-password-reset`. The prefix is
part of the name everywhere (`AuthSession_Module`, entity `AuthSession`, table
`auth_session`, use case `'authSession.signIn'`, routes under `/api/auth/`), and
each one is still a module of its own, with its own responsibility. `user` is not
one of them: a profile is far more than access. `workspace`, `workspace-member` and
`workspace-invitation` are another such family.

**Who may see or change a workspace's data is asked to `workspace-member`**
(`assertActive`, `assertAdmin`). Someone outside a workspace gets a 404, as if it
did not exist: a private workspace is never revealed.

### Anatomy

`src/backend/modules/<module>/` (kebab-case). The file set is fixed:

| File | What it holds |
|---|---|
| `<m>.schema.ts` | Zod schemas, DTO types and the `<M>ModuleName` const. The module's **public contract**: what goes in and out of its use cases and events. |
| `<m>.ts` | The entity: a class extending `Entity<typeof <M>Schema>`. Re-exports the schema file. |
| `infrastructure/<m>.table.ts` | The module's drizzle tables. |
| `<m>.repository.ts` | `find` / `count` / `persist` and a `<M>_Criteria` interface. **The only file that touches the database.** |
| `<m>.module.ts` | `<M>_Module extends Module`: the use cases and the event emitters. `static initialize(base, deps?)`. |
| `<m>.routes.ts` | `register<M>Routes(base, module)`: the module's HTTP routes on `base.http`. They read the request, call a use case and answer. Only when it has routes. |
| `<m>-options.ts` | `<M>_Options`: settings the module takes at `initialize` (from `config.ts`). Only when it has any. |
| `value-objects/<name>.ts` | Values with rules of their own that only this module uses (see Value objects). |
| `<m>.deps.ts` | `<M>_Deps`: the modules this one depends on, imported with `import type`. Only when it has any. |
| `<m>.workers.ts` | What this module does **in reaction** to events: its own or its dependencies'. |
| `errors/<error>.ts` | One class per domain error. |
| `events/<m>-<verb>.ts` | One class per domain event. |
| `*.test.ts` | Tests, next to what they test. |

`services/` is for what is neither a use case nor a query: a client for an outside
API, a pure mapper, a multi-step process.

Naming is not negotiable: folder `delta-review`, class `DeltaReview_Module`, table
`delta_review`, child table `delta_review__comment`, use case
`'deltaReview.approve'`, event `'deltaReview.approved'`, error file
`delta-review-not-found.ts`.

**Everything `<m>.schema.ts` exports starts with the entity's name**, so it reads
the same wherever it is imported (`@newt/api` re-exports it to the frontend): `UserSchema`,
`UserNickSchema`, `UserCreateSchema` / `UserCreateDTO`,
`UserUpdateSchema` / `UserUpdateDTO`, `AuthSessionSignInSchema`.

### How modules talk

There are exactly two ways, and the choice is about meaning:

- **A call to a use case**, when things must happen together or not at all. The
  callee joins the caller's transaction: one commit for the outermost use case.
- **An event**, when something is a *consequence* of something else. The
  publisher does not know who listens.

Rules:

- A module that **knows** another (it is in its `<M>_Deps`) may call that
  module's use cases and subscribe to its events. Nothing else: never import
  another module's repository, table or entity internals, and never read another
  module's tables (no joins across modules). Reads go through the owner's use
  cases.
- **Dependencies form a tree, never a cycle.** `index.ts` initializes modules in
  dependency order, so a cycle cannot even boot. When two modules seem to need
  each other, one of them stops calling and starts listening: the lower module
  publishes an event, the upper one reacts to it.
- A module never knows who depends on it. If A must react to B, A depends on B
  and subscribes to B's events; B is untouched.

## The entity

The entity is a schema plus behaviour. The zod schema is the single source of
truth for its shape; `Entity` keeps the data valid and tracks what changed.

```ts
export class Rule extends Entity<typeof RuleSchema> {
  private constructor(input: EntityInput<RuleDTO>, isNew: boolean) {
    super(RuleSchema, input, isNew)
  }

  /** Rebuilds a stored rule: nothing new happened. */
  static fromDTO(dto: RuleDTO): Rule {
    return new Rule(dto, false)
  }

  /** A rule that did not exist: id and timestamps are assigned here. */
  static create(input: EntityInput<RuleDTO>): Rule {
    const rule = new Rule(input, true)
    rule.trackEvent(new Rule_Created(rule.toDTO()))
    return rule
  }

  update(changes: Partial<Omit<RuleDTO, 'id'>>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Rule_Updated({ dto: this.toDTO(), changes: diff }))
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Rule_Deleted(this.toDTO()))
  }
}
```

- `create` for something new, `fromDTO` for something stored. `isNew` is decided
  by which one is called, never by whether an id is present.
- Every change goes through `change()`, which validates each field against the
  schema and ignores values that did not actually change.
- Domain rules about the entity's own data live in the entity's methods; rules
  that need other data live in the use case.
- The entity records events with `trackEvent`; the repository dispatches them on
  `persist`. Nobody else publishes an entity's events.
- Outside the module an entity does not exist: use cases return `toDTO()`.

## Value objects

A value with rules of its own (how it is written, how it is compared, how it is
made) is a value object, defined once: a type and a const with the same name.

```ts
export type Email = string

export const Email = {
  schema: z.email().refine(email => email === email.toLowerCase()),   // how it is stored
  from(value: string): Email { ... },                                 // what was typed → the value, or a ValidationError
} satisfies ValueObject<Email, string>
```

- Shared ones live in `core/value-objects/<name>/` (`Email`); one only a module
  uses lives in its `value-objects/` (`AuthPasswordResetEmail`). `SecretToken`
  (a session cookie, a reset link) is shared, so it is in `core`.
- The entity's schema uses `X.schema`; the entity runs input through `X.from`
  before storing it. Input schemas stay lenient (any case, spaces) because
  `from` normalizes.

## Events

- Name: `'<module>.<verb in past tense>'` (`'rule.created'`), class
  `<M>_<Verb>` (`Rule_Created`), file `events/<m>-<verb>.ts`.
- Payloads:
  - `created`, `deleted`, `restored`: the DTO.
  - `updated`: `{ dto, changes }`: **the whole updated DTO and only the fields
    that changed.** Listeners never need to ask again, and can ignore updates
    that do not concern them by looking at `changes`.
- Events are **emitted after commit**. If the use case fails, nothing is emitted
  (unless its error is built with `{ commitOnThrow: true }`).
- A handler runs after the publisher's transaction closed and outside it. If it
  writes, it does it through a use case, which opens its own transaction.
- Each module exposes its events as `DomainEventEmitter`s (`module.created`,
  `module.updated`…); subscriptions live in `<m>.workers.ts`.
- **What cannot be taken back leaves from a worker, never from a use case**: an
  email is sent by the `mail` module, called from the sender's `<m>.workers.ts`
  after its event, outside any transaction (`mail.send` refuses to run inside
  one). The module writes its own email, as a value object (`value-objects/auth-password-reset-email.ts`); `mail` only
  sends it, over the SMTP server set in the environment.

## Use cases

- Every public method of a module is a use case: `@UseCase('<module>.<verb>')`.
  It runs in a transaction and is traced by name.
- Validate the input at the door: `Create<M>Schema.parse(input)`.
- Shape: load → decide → change the entity → `persist` → return DTOs.
- **No list is returned whole.** A use case that lists takes a `PageRequest`
  (`size`, `cursor`) and returns a `Page` (`items`, `hasMore`, `total`), from
  `core/pagination`. The cursor is the id of the last item already shown (ids are
  v7, so they sort by time); the repository reads `size + 1` rows ordered by id and
  `toPage` drops the extra one. Routes read the page with `pageRequestFrom(request)`
  (`?size=&cursor=`, 20 by default, at most 100). Paginate on the table that owns
  the order: a person's workspaces are paged over their memberships, and only
  that page of workspaces is read.
  Exception: a list bounded by design, with a small fixed limit (a workspace's
  dimensions: at most 20, with at most 50 values each), is returned whole.
- To turn a `find` into one item or an error, use `this.resolve(find, onMissing)`
  from `Module`: the caller picks the error.
- **What only its owner may change takes the actor, not an id**: `updateMine(input)`
  reads `currentActor().userId`. A use case that took a user id would let anyone
  change anyone.

## Errors

Domain errors live in the module's `errors/`, one class each, with a stable
`code` (`'rule.not_found'`). They extend a base from `core/errors`, and the base
decides the HTTP status:

| Base | Status | When |
|---|---|---|
| `NotFoundError` | 404 | the requested resource itself does not exist |
| `ValidationError` | 400 | the input is wrong |
| `ReferenceNotFound` | 400 | an id **inside** the input points nowhere |
| `ConflictError` | 409 | the current state does not allow it |

An unknown id inside a payload is a 400, not a 404: the request is what is wrong.

## Data

- **Ids are UUIDv7**, assigned by `Entity` (`Bun.randomUUIDv7()`). Never pass an
  id in a create input, never use a v4 id: pagination by id relies on v7
  sorting by time.
- **Soft delete.** Rows carry `deleted_at`; every query starts by excluding
  deleted rows; unique indexes are partial (`WHERE deleted_at IS NULL`). An
  append-only log is the exception and says so in its migration.
- **Migrations are pairs** (`000NN_<name>_up.sql` / `_down.sql`), numbered in
  order. An applied migration is never edited: a change is a new migration.
  Stored data must survive every migration; never require starting from scratch.
- Table names: the module in snake_case; a child table is
  `<module>__<child>`.
- Storage is SQLite (`bun:sqlite` with drizzle's query builder) in WAL mode. Do
  not design around the database: the entity and the use cases come first, the
  tables follow them.

## Changing the database

1. Add the pair in `src/backend/migrations/` with the next free number, zero
   padded to five digits: `00002_<name>_up.sql` and `00002_<name>_down.sql`.
2. `up` changes the structure and keeps every stored row: new columns get a
   default, a renamed or reshaped table copies its rows over. `down` undoes
   exactly what `up` did.
3. Update the module's `infrastructure/<m>.table.ts` and repository to match.
4. Check it: `bun run migrate:up`, `bun run migrate:down`, `bun run migrate:up`
   again, and a test with rows stored before the migration that are still there
   after it.

The server applies pending migrations when it starts; `bun run migrate:status`
lists them.

## Adding a module

`modules/user` is the reference for a module on its own; `modules/auth-session` for one
with dependencies, options, a value object, routes and a reaction to another
module's event (`auth-session.workers.ts` listens to `authCredential.changed`).

1. Propose the module: its one responsibility, the modules it depends on, its use
   cases, its events and its table. Wait for approval.
2. Create `src/backend/modules/<m>/` with the fixed file set: schema, entity,
   table, repository, module, the `errors/` and `events/` it needs, and
   `<m>.routes.ts`, `<m>.deps.ts` and `<m>.workers.ts` only if it has routes,
   dependencies or reactions.
3. Write its migration (see above).
4. Initialize it in `index.ts`, after every module it depends on, passing them as
   its deps.
5. No tests: nothing inside `modules/` gets them (see Tests).
6. `bun run typecheck`, `bun run lint`, `bun run test`.

## Tests

- `bun test`, files next to the code (`<name>.test.ts`).
- Test `core` and `base` pieces directly.
- **For now, nothing inside `modules/` gets tests**: not `<m>.module.ts`,
  `<m>.repository.ts`, `<m>.routes.ts` nor value objects. Their behaviour is
  checked by running it.
- Tests read as behaviour: given, when, then. A timeline is often the clearest
  assertion (`['BEGIN', 'COMMIT', 'event:rule.created']`).
- A test that cannot fail is not a test: break the code on purpose once and see
  it fail.

## Conventions

- Everything is in English: code, comments, docs. Domain names follow newt's
  vocabulary: workspace, dimension, feature, artifact, rule, entity, lifecycle,
  actor, parameter, proposal, delta, revision, release, bug, board.
- **One exported element per file** in `core` and `base`: a type, an interface,
  a class or a function, each in its own file named after it. Inside a module the
  fixed file set rules: `<m>.schema.ts` holds all the module's schemas and DTO
  types, because together they are its contract.
- Comments say why, not what. Match the comment density of the code around.
- Code style matches the rest of the repo: no semicolons, single quotes.
- Settings that change per installation come from environment variables, with a
  default, in `config.ts` (`API_PORT`, `NEWT_DB_PATH`, `NEWT_SESSION_DAYS`), and
  reach a module through its options. Never read `process.env` inside a module.
  A new setting also goes in `scripts/seed-env.ts`, so `bun run seed:env` writes it
  to `.env` (with a generated value, if it is a secret).
