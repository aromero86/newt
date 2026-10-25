# Building an application with newt

How an application is built on the framework: its contexts, its modules and the
rules they follow. [`examples/notes`](../examples/notes) follows every rule here,
and is the quickest way to see them together. How data is kept, and how to keep
it somewhere new, is in [`stores.md`](stores.md).

## Contexts

An application is one or more bounded contexts. Each one owns its store, its
modules and, if it has any, its entry points.

```ts
const base = new AppBase({ name: 'shop', store: await SqliteStore.open({ path: 'data/shop.db', migrations: 'migrations' }) })
```

- **Each context picks its store** and opens it up to date (opening applies the
  pending migrations, the context's and then the framework's own), then builds its
  `Base` on it. `Base` gives every module the store, the `invocations` of its use
  cases, the event `bus`, the `publisher` its repositories publish to, and the
  `jobs` of its `handler` subscriptions.
- **An application gives its modules more by extending `Base`**: an HTTP router, a
  mailer, a query builder on the store's connection.

  ```ts
  class AppBase extends Base<SqliteStore> {
    readonly http = new HttpRouter()
    readonly db = kyselyFor<AppDatabase>(this.store)
  }
  ```
- **A context is a `BoundedContext`**: `start()` starts its job worker, `stop()`
  waits for the jobs in progress and closes its store. How it is served is the
  application's: `serve` from `newt/http` is one way.
- **Contexts depend on each other as a tree**, never a circle: each one is opened
  after the ones it uses and receives them.
- A context reaches another only through that one's use cases and events, never
  its store. A call to another context is like a call to an outside API: what it
  saved stays saved whatever the caller does next, so the caller puts it after
  whatever may still fail, and makes it safe to run again.

## Entry points

- An entry point translates a request into a use case call, and its result into a
  response. **No business logic in an entry point.**
- With `newt/http`, each module registers its routes on the context's
  `HttpRouter` (`<m>.routes.ts`), all under one prefix (`/api` by default). A
  route's path types its params (`/notes/:id` gives `request.params.id`). Whatever
  a route throws becomes a response: a domain error with its status and code, an
  invalid input a 400, anything else a 500 that says nothing about the inside.
- **Every route needs a session** unless it is registered with `{ public: true }`.
  The router asks its `Authenticator` who sent the request, and the route runs as
  that actor: any use case it reaches knows who is doing it through
  `currentActor()`. Never pass the user id around by hand. Any other entry point
  (a CLI, an MCP server, a script) runs as an actor the same way, with
  `runAsActor`.
- **Routes that share a prefix may share a middleware**: `http.group(prefix,
  middleware)`. It runs after the session is checked, around each route of the
  group, and may answer instead or go on with `next()`, typically inside a scope of
  its own (see *Who and where* below). A route's params are its group's and its own.

## Who and where: the actor and other scopes

**The actor** is who is doing what is being done. The framework only knows its
`userId`; an application adds what it needs by augmenting the `Actor` interface,
once, in a file every program of the application loads:

```ts
import 'newt/core'

declare module 'newt/core' {
  interface Actor {
    /** The session it came through; null with an access token. */
    sessionId: string | null
  }
}
```

From then on `currentActor()` returns those fields, and the authenticator must give
them.

**Authentication** (who is it) is the router's `Authenticator`: it reads the
request (a session cookie, a token) and asks a module of sessions, through a use
case, who that is. A session stores only the hash of its token (`SecretToken.hash`),
so a copy of the database opens nothing. **Authorization** (may they do this) is
never in the actor: a use case asks the module that owns that knowledge (`members.
assertActive(workspaceId)`), every time, so a permission taken away counts at once.
Whoever is not a member gets a 404, not a 403: a private thing never says it exists.

**Other scopes.** A value that travels with the work like the actor (the workspace
a request is about, a tenant) is a scope the application defines with `defineScope`:

```ts
export const workspace = defineScope<{ workspaceId: string, role: 'admin' | 'member' }>('workspace')

const workspaces = base.http.group('/workspaces/:workspaceId', async (request, next) =>
  workspace.run(await members.enter(request.params.workspaceId), next))   // 404 if not a member

workspaces.get('/brands', async request => Response.json(await brands.list(…)))
// in the use case: const { workspaceId } = workspace.current()
```

The middleware checks membership once for all the group's routes, and no use case can
forget to: without a workspace in scope, `current()` throws. Whatever does not come
through the router (a worker, a script, an MCP server) enters it itself with
`workspace.run(...)`; a worker knows which from its event. An application with only
users defines nothing: the actor is enough.

## Modules

### One responsibility

A module owns one thing: its data, the rules about that data, and what happens
when it changes. If describing a module needs an "and", it is two modules. A
module is not a table and not a screen: it is a responsibility.

**The module's entity has the module's name** (`note` → `Note`). An entity named
otherwise is a second responsibility, and goes to a module of its own.

**Modules on the same subject share a prefix**, so they sit together:
`auth-credential`, `auth-session`. The prefix is part of the name everywhere
(`AuthSession_Module`, entity `AuthSession`, table `auth_session`, use case
`authSession.signIn`), and each one is still a module of its own.

### Anatomy

`<context>/modules/<module>/` (kebab-case):

| File | What it holds |
|---|---|
| `<m>.schema.ts` | Zod schemas and DTO types: the module's **public contract**, what goes in and out of its use cases and events. Everything it exports starts with the entity's name (`NoteSchema`, `NoteCreateDTO`). |
| `<m>.ts` | The entity: a class extending `Entity<typeof <M>Schema>`. Re-exports the schema file. |
| `<m>.repository.ts` | **The only file that touches the store.** |
| `<m>.module.ts` | `<M>_Module extends Module`: the use cases and its `events`. `static initialize(base, deps?)`. |
| `<m>.routes.ts` | Its routes, when it has any. |
| `<m>.workers.ts` | What it does **in reaction** to events: its own or its dependencies'. |
| `<m>.deps.ts` | `<M>_Deps`: the modules it depends on, imported with `import type`. |
| `<m>-options.ts` | `<M>_Options`: settings it takes at `initialize`. |
| `value-objects/<name>.ts` | Values with rules of their own that only it uses. |
| `errors/<error>.ts` | One class per domain error. |
| `events/<m>-<verb>.ts` | One class per domain event. |
| `*.test.ts` | Tests, next to what they test. |

Naming: folder `purchase-order`, class `PurchaseOrder_Module`, table
`purchase_order`, child table `purchase_order__line`, use case
`purchaseOrder.confirm`, event `purchaseOrder.confirmed`, error file
`purchase-order-not-found.ts`.

### How modules talk

Exactly two ways, and the choice is about meaning:

- **A call to a use case**, when the caller needs its answer now: **reads and
  checks**, from anywhere. (Never call one from a save's hook: it would run in that
  save's transaction.)
- **An event**, when something is a *consequence* of something else. The
  publisher does not know who listens.

**Writing to another module happens only from a worker** reacting to an event,
never from the middle of a use case's own work. Each module's save is a transaction
of its own: if `order.place` reserved stock and then failed saving the order, the
stock would stay reserved for an order that does not exist, and nothing would ever
finish the work. A worker's job, instead, runs again until it completes; what it
writes is safe to run again (idempotent), so the flow always converges.

| Writing to another module from… | If it fails halfway… |
|---|---|
| a use case a request called | it stays half done, and nothing finishes it |
| a use case a worker called (a `handler`) | its job runs again until it completes |

The framework checks it as it runs: a save of module B under a use case of module A,
outside a worker, is a warning (the default) or an error (`writeRule: 'error'` in a
context's `Base`, for tests and development). An exception that is justified is said
where it is seen: `@UseCase({ writesTo: ['workspaceMember'] })`, with the reason
beside it.

**A module is one aggregate.** What must be saved together, all or nothing, is one
module. Two modules whose data must always change together are one; otherwise one
of them follows the other through events.

- A module that **knows** another (it is in its `<M>_Deps`) may call its use cases
  and subscribe to its events. Never its repository, its tables or its entity:
  reads go through the owner's use cases.
- **Dependencies form a tree, never a cycle.** When two modules seem to need each
  other, one stops calling and starts listening.
- A module never knows who depends on it.

## The entity

The entity is a schema plus behaviour. The zod schema is the single source of truth
for its shape; `Entity` keeps the data valid and tracks what changed.

```ts
export class Note extends Entity<typeof NoteSchema> {
  private constructor(input: EntityInput<NoteDTO>, isNew: boolean) {
    super(NoteSchema, input, isNew)
  }

  static fromDTO(dto: NoteDTO): Note {
    return new Note(dto, false)
  }

  static create(input: { title: string, body: string, authorId: string }): Note {
    const note = new Note({ ...input, archived: false }, true)
    note.trackEvent(new Note_Created(note.toDTO()))
    return note
  }

  update(changes: Partial<Pick<NoteDTO, 'title' | 'body' | 'archived'>>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Note_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Note_Deleted(this.toDTO()))
  }
}
```

- `create` for something new, `fromDTO` for something stored: `isNew` is decided by
  which one is called, never by whether an id is present.
- **Only the entity changes itself**: `change()` is protected, so a use case calls
  the entity's methods (`update`, `archive`…), which say what happened with
  `trackEvent`. `change()` checks each field against the schema and ignores values
  that did not actually change.
- Rules about the entity's own data live in its methods; rules that need other data
  live in the use case.
- **Its methods take domain data, not the input DTO.** The DTO is the API's contract
  (what a client sends, before it is checked); the entity gets what it needs to be
  born, checked and often completed by the use case: an order is placed with the
  actor's id and each line's price, which no client sends. Small inputs go inline
  (`{ name, priceCents }`); one that deserves it is a type with a business name in the
  entity's file (`OrderPlacement`), never a `…DTO` and never in the schema file.
- **Each kind of thing is told once per save, as it stands.** An event replaces an
  earlier one of its name not yet saved, so two `update` calls before a save make one
  `updated`, with both changes. Two different kinds in one save (`created` and
  `updated`) usually mean the use case does two things.
- **`getChanges()` and `getPrevious()`** are the transition a save makes: the fields
  that changed, as they are now and as they were when it was read.
- **It is validated twice, on purpose.** The use case validates what comes in (its
  input schema, lenient, a 400 for the client); the entity validates its state
  (strict, on every change, and on what is read from the store). One rule, written
  once: the input schema is derived from the entity's (`NoteSchema.pick(...)`).
- **It has a `version`**: 0 until it is saved, then the one it is stored with.
  `fromDTO` gets it from the row (the constructor throws without it, since saving
  it could overwrite someone), and the repository moves it on once the save
  commits.
- Outside its module an entity does not exist: use cases return `toDTO()`.

## Repositories

A repository is the only place that reads and writes a module's entities.

**`TableRepository`, when the entities are the rows of one table**, on any store:
say how a row becomes an entity, and `find`, `first`, `count`, `page` and `persist`
come done.

```ts
export type NoteRow = NoteDTO & { version: number, deletedAt: string | null }

export class Note_Repository extends TableRepository<Note, NoteRow, AppBase> {
  constructor(base: AppBase) {
    super(base, base.store.table<NoteRow>('note', { types: { archived: 'boolean' } }), { softDelete: true })
  }

  protected toEntity(row: NoteRow): Note {
    return Note.fromDTO(row)
  }
}
```

What to find is said with **criteria**, field by field, which every store
understands:

```ts
repo.find({ workspaceId, archived: false })                       // equal; null is "has none"
repo.find({ id: { in: ids } })
repo.count({ workspaceId, name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } })
repo.page({ workspaceId, ...filters }, pageRequest)
```

The operators are `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` and `ieq` (equal,
whatever the case of A to Z); several on one field must all hold, and a field or an
operator left `undefined` is no condition, so an optional filter needs no `if`.
Groups nest: `and` (every one), `or` (at least one):

```ts
repo.find({ workspaceId, or: [{ priceCents: { lt: 500 } }, { and: [{ brandId }, { archived: false }] }] })
```

Every store answers them as SQL would ([`stores.md`](stores.md) says how). The
table's options (`types`, `unique`) are said in the same words to every store, so the
repository moves between stores unchanged. A row whose shape is not the entity's DTO
says how in `toRow` and `toChanges`.

**Filters a client sends** are not criteria: criteria are for the module's code, and
open; a client's filter is part of the public contract, and closed. `defineFilter`
declares what a client may filter by, each field with its operators, and the limits:

```ts
// note.schema.ts
export const NoteFilter = defineFilter({
  title: { field: 'title', value: z.string(), ops: ['eq', 'ieq'] },
  written: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 3, maxConditions: 20 })
export type NoteFilterDTO = z.infer<typeof NoteFilter.schema>   // for the frontend

// note.module.ts
const criteria = NoteFilter.toCriteria<NoteRow>(NoteFilter.schema.parse(input))
return this.repo.page({ and: [criteria, { authorId: currentActor().userId }] }, page)
```

A field or operator not declared is a 400; what the system imposes goes beside the
client's filter, in an `and`, where it cannot be escaped. Every operator offered is a
query anyone can run: an `or` across fields keeps a database from using its indexes,
so offer what the data can answer quickly. A filter tree travels in a body
(`POST /notes/search`), not a URL.

**Queries a table cannot say** (a sum, a join, a report) go through the store's own
API. Kysely on the store's connection is the recommended way (`newt/kysely`):
the same query runs on SQLite, Postgres or MySQL, field names are the rows'
(`productId`), and it joins the transaction in progress.

```ts
class AppBase extends Base<SqliteStore> {
  readonly db = kyselyFor<AppDatabase>(this.store)
}
// in a repository
const { level } = await this.base.db.selectFrom('stock_movement')
  .select(eb => eb.fn.sum<number>('quantity').as('level'))
  .where('productId', '=', productId)
  .executeTakeFirstOrThrow()
```

**Keep repositories portable**: `TableRepository` by default, Kysely for what it
cannot say, and SQL of one store only when there is no other way (SQLite's full-text
search, say), kept in one place and flagged. Then moving to another store is a new
store and its migrations, not new repositories.

**References between modules** (a product's brand, its category) are ids only, as
Vaughn Vernon's aggregates: never the other entity, never a join to its table.

- On write, the use case checks a reference exists by asking its module (a read):
  `this.resolveRefs({ brandId }, { brandId: this.deps.brand })` gives a
  `ReferenceNotFound` (400) for one that points nowhere; `null` is "none".
- When the referenced thing goes, the module that points at it follows its event,
  from a worker: a `handler` on `brands.events.deleted` calling `products.forgetBrand`, which finds
  the products of that brand when it runs.
- Showing names, not ids, is the client's composition (it asks both modules), or a
  read model a worker keeps from the events.
- A reference may point at something deleted for a moment, between the check and
  the save, or before the worker runs: that is accepted, and the worker clears it.

**`Repository`, for anything else**: entities spread over several tables, a query
a criterion cannot say, a store's own API. It gives `save`, and the repository
writes each entity its own way:

```ts
export class Product_Repository extends Repository<Product, AppBase> {
  persist(...products: Product[]): Promise<void> {
    return this.save(products, product => { /* insert, update or delete it, with the adapter's API */ })
  }
}
```

### Saving

A transaction is one save, `repo.persist(...entities)`, never a whole use case.

- `persist` saves one or more instances **of its module's entity** at once, all or
  none, with the events they tracked: the jobs of those events are written in the
  same transaction, and their `fireAndForget` handlers run after it commits.
- It writes only what changed, and only if each stored entity is still the version
  it was read as: otherwise it throws `ConcurrencyConflict` (409) and writes
  nothing. A new one that collides with a key or a unique value throws it too.
- **`@UseCase({ retryOnConflict: true })`** runs the use case again on a
  `ConcurrencyConflict`, up to three times, reloading and applying the change to
  what is stored now. Use it on every use case that loads, changes and saves, and
  does nothing irreversible before saving.
- **A rule over several rows** (a workspace keeps an admin, a stock never below
  zero) is not protected by a version: `save`'s `after` hook checks it, in the same
  transaction, after the writes; throwing rolls it all back. The save names what the
  rule guards, so no other save guarding the same thing runs in between, in any
  store:

  ```ts
  await this.save(movements, movement => this.write(movement), {
    guard: products.map(id => `stock:${id}`),
    after: async () => { /* sum each product's movements; below zero → throw */ },
  })
  ```

  Saves of other products never wait. A save with `after` must name its `guard`,
  or it does not compile: `guard: []` says, where it is read, that none is needed.
  `before` writes what must go first. The use case still checks first, for a clear
  answer in the usual case.
- A write that only notes something happened (`lastUsedAt`) is not a change of the
  entity: the repository writes it with `table.patch(id, changes)`, which leaves the
  version alone, so parallel requests never collide.
- **A value many change at once (a stock, a balance) is not a field updated in
  place**: every change would collide with the others. It is a module of movements,
  only ever inserted, and the value is what they add up to.

## Use cases

- Every public method of a module is a use case, marked `@UseCase()`. It is named
  after its module and itself (`list` of `note` is `note.list`), and each call is
  an invocation: a span of the trace, inside its caller's when another use case
  calls it. It holds no transaction: each `persist` is one.
- Validate the input at the door: `<M>CreateSchema.parse(input)`.
- Shape: load → decide → change the entity → `persist` → return DTOs. Save once, at
  the end. When a use case cannot avoid saving in steps (or calling another
  context), put first what may fail, and make every step safe to run again.
- **No list is returned whole.** A use case that lists takes a `PageRequest`
  (`size`, `cursor`) and returns a `Page` (`items`, `hasMore`, `total`). The cursor
  is the id of the last item shown: ids are v7, so they sort by time.
  `TableRepository.page` does all of it; routes read the page with
  `pageRequestFrom(request)`. The page of entities becomes a page of DTOs written
  out, so it reads as what it is:

  ```ts
  const found = await this.repo.page(criteria, page)
  return { items: found.items.map(note => note.toDTO()), hasMore: found.hasMore, total: found.total }
  ```
- **A flow over several modules can fail halfway**, since each step is its own
  transaction: an order's stock reserved, and then its confirmation not saved. It
  converges because every step is idempotent (reserving twice for the same order
  takes nothing more) and a worker's job runs again until it completes. When a flow
  may be stopped by another path (the order cancelled meanwhile), each step done has
  its **compensation**, a step that undoes it (giving the stock back), run from a
  worker on the event that stops the flow: a saga. A job that runs out of attempts is
  a flow stuck halfway: someone must look at it.
- To turn a `find` into one item or an error, use `this.resolve(find, onMissing)`
  from `Module`: the caller picks the error. `this.resolveRefs` turns the ids of an
  input into named references, or a `ReferenceNotFound`.
- **What only its owner may change takes the actor, not an id**: `updateMine(input)`
  reads `currentActor().userId`.

## Events

- Name: `<module>.<verb in past tense>` (`note.created`), class `<M>_<Verb>`
  (`Note_Created`, with a static `eventName`), file `events/<m>-<verb>.ts`.
- Payloads: `created` and `deleted` carry the DTO; `updated` carries
  `{ dto, changes, previous }`: the whole DTO, the fields that changed, and what they
  were before. Each field's transition is `previous[field]` → `changes[field]`.
- **An event is published after the commit of the save that tracked it.** A save
  that rolls back publishes nothing.
- Events come from entities, through their repository. Something that is not an
  entity's may publish one on `base.bus`, with the same guarantees: its jobs in the
  transaction in progress, its `fireAndForget` handlers after the commit.
- Each module offers its events under `events`, made with `eventsOf`:

  ```ts
  this.events = eventsOf(base.bus, { placed: Order_Placed, confirmed: Order_Confirmed })
  ```
- Reactions live in `<m>.workers.ts`, always the same way: the module that reacts
  subscribes to the other's event, `deps.<module>.events.<event>.subscribe(fn, opts)`,
  and `opts.strategy` says how. Each strategy is typed with what it takes:
  - **`'handler'`, durably**: a job is written in the outbox in the transaction of
    the change, so both are stored or neither is; a worker runs it after the commit,
    again with a backoff if it fails, until it runs out of attempts (5, or
    `attempts`). It names its `queue`, in full:
    `<module that reacts>.<use case>.on.<module that tells>.<event>`. The emitter
    refuses a queue that does not end with its own event.

    ```ts
    deps.order.events.confirmed.subscribe(order => notifications.orderConfirmed(order), {
      strategy: 'handler',
      queue: 'notification.orderConfirmed.on.order.confirmed',
    })
    deps.product.events.updated.subscribe(async ({ changes, dto }) => {
      if ('priceCents' in changes) await prices.record(dto)
    }, { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })
    ```

    The callback only calls one use case of the module that reacts, with what it
    takes from the event; a condition on the event (a change of the price, not of the
    name) may decide whether it calls it at all, never business logic. Renaming the
    queue leaves the pending jobs under the old name, and the worker warns at start
    about jobs of a queue nobody serves.
  - **`'fire-and-forget'`, in memory**: run after the commit, and lost if it fails
    or the process stops. For what may be lost: a cache, a metric, an email whose
    payload must never be stored.
- A handler runs as the system, never as the publisher's actor. It calls a use case
  of its own module, which is the only place it may write to another module (see
  *How modules talk*). It may run more than once: it is idempotent.
- **What cannot be taken back leaves from a worker, never from a use case**: an
  email is sent after the event of what it is about, so only for what was saved.
- **An event's shape only grows.** Its jobs keep it as it was published, and may run
  after a deploy with the code of then: an event only gains optional fields. A change
  that breaks its shape comes with a migration that rewrites its pending jobs.

## Errors and what they say

Domain errors live in the module's `errors/`, one class each, with a stable `code`
(`note.not_found`). They extend a base, which decides the HTTP status:

| Base | Status | When |
|---|---|---|
| `NotFoundError` | 404 | the requested resource itself does not exist |
| `ValidationError` | 400 | the input is wrong |
| `ReferenceNotFound` | 400 | an id **inside** the input points nowhere |
| `UnauthorizedError` | 401 | nobody is signed in, or the credentials are wrong |
| `ForbiddenError` | 403 | whoever asks may not do this |
| `ConflictError` | 409 | the current state does not allow it |
| `ConcurrencyConflict` | 409 | someone saved it since it was read |

The framework's own errors speak English. An application in another language
replaces their messages once, at startup:

```ts
setMessages({ concurrency_conflict: () => 'Alguien lo ha cambiado mientras tanto.' })
```

## Value objects

A value with rules of its own (how it is written, compared or made) is a value
object, defined once: a type and a const with the same name.

```ts
export type Email = string & z.$brand<'Email'>

export const Email = {
  schema: z.email().refine(email => email === email.toLowerCase()).brand<'Email'>(),   // how it is kept
  from(value: string): Email { … },                                                     // what was typed → the value, or a ValidationError
} satisfies ValueObject<Email, string>
```

- **Its type is branded**: at runtime an `Email` is a string, but to the compiler a
  plain string is not an `Email` until it went through `Email.from` (what someone
  typed) or `Email.schema` (what was stored). A function that takes an `Email`
  cannot be handed an unchecked string by mistake.
- The framework has `Email` and `SecretToken`. The entity's schema uses `X.schema`;
  an input schema stays lenient (a plain `z.email()`), and the entity or the use case
  runs it through `X.from` before keeping it.
- **Where values come back from storage, say their type there**: a row type says
  `email: Email` (and so does the table type Kysely is given). Nothing else needs a
  cast.
- A string from outside that must be one (a token from a cookie) is checked with
  `X.schema.safeParse(value)`, and its `data` is the value.

## Data

- **Ids are UUIDv7**, given by `Entity`. Never pass an id in a create input:
  pagination by id relies on v7 sorting by time.
- **Every entity's row has a `version`**, which saves check and move on.
- **Soft delete** (`softDelete: true`) keeps a deleted row with its `deletedAt`, and
  leaves it out of every find. A unique value should be unique among the rows not
  deleted: on SQLite, a partial unique index (`WHERE deleted_at IS NULL`).
- Do not design around the store: the entity and the use cases come first, the
  tables follow them.

## Analytics

Data meant to be read a lot at once (sales by month, by product, by customer) goes to
an analytical database through the `Analytics` port: only ever appended to, never
changed. It has no transactions, so it is fed by `handler` workers after the events of
what the store saved; each row carries an id of its own (the order line's), so a job
that runs twice adds nothing. Reading it is each adapter's own query language. No
adapter comes with the framework yet; `MemoryAnalytics` (in `newt/port-analytics/contract`) is the one for
tests, and `describeAnalyticsContract` checks a new one.

## Observability

Each context may hand its `Base` a `Tracer`: every use case call is a span, named
after it, with the context, module and use case as attributes, a child of its
caller's, marked with the error when one that is not a domain error escapes, and
with an event for each retry on a conflict. The job worker's own steps are spans
too. Without a tracer, nothing is recorded.
