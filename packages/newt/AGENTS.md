# newt, for coding agents

The rules of building an application with newt, versioned with the package. Read it
before writing code; the full docs are the guide and the reference in newt's
repository (`web/guide`, `web/reference/rules.md`, `lint.md`, `stores.md`).

## What newt is

- A backend framework for Bun only (`Bun.serve`, `bun:sqlite`, `Bun.SQL`). Zod for schemas.
- An app is **bounded contexts**; each owns a **store** (SQLite, files, Postgres, MySQL) and **modules**.
- A module owns **one entity**, changes it only through its **use cases**, and tells what happened through **domain events**, delivered by a transactional outbox.
- Three checks keep it honest: the types (`bun check`), the lint (`newt-eslint`), and runtime rules that throw (below).

## Golden rules

1. One module, one responsibility: if describing it needs an "and", it is two.
2. A route does not think: it reads the request, calls one use case, answers.
3. Only the entity changes itself, with methods named after what happened.
4. Only the repository touches the store.
5. A transaction is one save (`repo.persist(...)`), never a whole use case.
6. A use case writes into another module only from a worker reacting to an event; an exception says `@UseCase({ writesTo: ['other'] })` with its reason in a comment.
7. What cannot be undone (an email, a call out) leaves from a worker, never from the use case that makes the change.
8. A job may run more than once: a second run finds nothing to do.
9. Modules and contexts never depend on each other in a cycle.
10. A module points at another's things only by id, never by its entity or table.
11. No list is returned whole unless the domain bounds it; every other list is a `Page`.
12. Who acts is `currentActor()`, never a user id passed by hand. May they: ask the module that knows, every time; a stranger gets a 404, not a 403.
13. Time is `now()`, never `new Date()`; tests hand the base a clock.

## A module's anatomy

`<context>/modules/<m>/`, kebab-case. Only these files and folders (`newt/module-anatomy`):

| File | Holds |
|---|---|
| `<m>.schema.ts` | Zod schemas, DTO types, input schemas, filters: the public contract. Imports only zod, `newt/contract`, value objects, other schemas. |
| `<m>.ts` | The entity (`extends Entity<typeof <M>Schema>`); re-exports the schema. |
| `<m>.repository.ts` | `<M>_Repository`: the only file that touches the store. |
| `<m>.module.ts` | `<M>_Module extends Module`: `static initialize`, `events`, the use cases. |
| `<m>.routes.ts` / `<m>.workers.ts` | Its routes; its reactions to events and schedules. |
| `<m>.deps.ts` / `<m>-options.ts` | `<M>_Deps` (modules it calls, ports, `import type`); `<M>_Options` (config). |
| `events/<m>-<verb>.ts`, `errors/<error>.ts`, `value-objects/`, `services/`, `*.test.ts` | One class per file; tests beside the code. |

Names, for folder `oauth-grant`: class `OauthGrant_Module`, `super('oauthGrant', base.invocations)`, entity `OauthGrant`, `OauthGrant_Repository`, table `oauth_grant`, use case `oauthGrant.redeem`, event `oauthGrant.replayed` (class `OauthGrant_Replayed`, file `events/oauth-grant-replayed.ts`), error code `oauthGrant.invalid_grant`, queue `token.revokeGrant.on.oauthGrant.replayed`.

A module reaches another only through its module, schema, events, errors and value objects (`newt/module-boundaries`).

## Entity, schema, repository

```ts
export class Order extends Entity<typeof OrderSchema> {
  private constructor(input: EntityInput<OrderDTO>, isNew: boolean) { super(OrderSchema, input, isNew) }
  static fromDTO(dto: OrderDTO & { version: number }): Order { return new Order(dto, false) }
  static place(input: { customerId: string, total: number }): Order {
    const order = new Order({ ...input, status: 'placed' }, true)
    order.trackEvent(new Order_Placed(order.toDTO()))
    return order
  }
  cancel(reason: string): void {
    this.change({ status: 'cancelled', cancelReason: reason })
    this.trackEvent(new Order_Cancelled(this.toDTO()))
  }
}
```

- Schema is `z.object` or `z.strictObject` (never `looseObject`/`catchall`/`passthrough`); ids are UUIDv7, given by `Entity`. Never take an id in a create input.
- Input schemas derive from the entity's (`OrderSchema.pick(...)`, `.shape.x`). Value objects: a branded type + `{ schema, from }`.
- An entity with secrets has a public schema: `Entity<typeof Full, typeof Public>`, keep a hash, never the secret.

```ts
export type OrderRow = OrderDTO & { version: number }
export class Order_Repository extends TableRepository<Order, OrderRow, ShopBase> {
  constructor(base: ShopBase) {
    super(base, base.store.table<OrderRow>('order'), { scope: { field: 'workspaceId', current: currentWorkspaceId } })
  }
  protected toEntity(row: OrderRow): Order { return Order.fromDTO(row) }
}
```

- `scope` is required: `{ field, current }` for rows of a tenant, or `scope: 'none'` with a comment saying why. Never drop a scope to make something work. A scoped repository's `find/first/count/page` see only the current scope; reading across on purpose is the protected `findInEveryScope`, behind a method named so. Kysely, `this.table`, `saveRows` and `after` add the `where` themselves.
- Criteria: `{ field: value, field: { in, ne, gt, gte, lt, lte, ieq }, or: [...], and: [...] }`; `allOf(a, b)`. Clients filter only through `defineFilter` in the schema. Queries criteria cannot say: Kysely (`newt/kysely`) in the repository.

## Use cases

```ts
@UseCase()
async cancel(id: string, input: unknown): Promise<OrderDTO> {
  const { reason } = OrderCancelSchema.parse(input)            // validate (400)
  const order = await this.resolve(() => this.repo.find({ id }), () => new OrderNotFound(id)) // load (404)
  if (!await this.deps.member.isMember(currentActor().userId)) throw new OrderNotFound(id)    // may they
  order.cancel(reason)                                          // the entity changes itself
  await this.repo.persist(order)                                // one save
  return order.toDTO()                                          // DTOs out, never entities
}
```

- Every public method of a module is `@UseCase()`; helpers are `private` (`newt/use-case`).
- What a client sends comes in as `unknown` and is parsed with the input schema. Lists take a `PageRequest` and return `mapPage(await this.repo.page(criteria, page), e => e.toDTO())`.
- A use case runs again on `ConcurrencyConflict` (up to 3 more times): nothing irreversible before the save. One that must not: `@UseCase({ retryOnConflict: false })` with the reason.
- References: `await this.resolveRefs({ productId }, { productId: this.deps.product })` (400 `ReferenceNotFound`).

## Saving

```ts
async persistWithNameFree(board: Board): Promise<void> {
  await this.save([board], each => this.write(each), {
    guard: [`boardName:${board.workspaceId}:${board.name.toLowerCase()}`],
    before: async () => { /* take a counter row, under the guard */ },
    after: async () => { if (await this.count({ name: { ieq: board.name } }) > 1) throw new BoardNameTaken(board.name) },
  })
}
```

- A rule over several rows is checked in `after`, under a `guard` as narrow as the rule; `guard: []` says none is needed. A save that reads rows and guards nothing throws `[guard rule]`.
- Check first in the use case for the clear answer; a unique index has the last word (`DuplicateValue`).
- A row created meanwhile that `after` finds: `this.conflict()` (the use case runs again).
- Several entities of the module at once: one `persist(a, b)`. Rows of no entity: `saveRows(write, { guard })`; for good: `purge(criteria)`. `table.patch` only for notes like `lastUsedAt`.
- Never `store.transaction` in a module (lint).

## Events, workers, schedules

```ts
// events/order-placed.ts
export class Order_Placed implements DomainEvent<OrderDTO> {
  static readonly eventName = 'order.placed'
  readonly name = Order_Placed.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: OrderDTO) {}
}
// order.module.ts constructor
this.events = eventsOf(base.bus, { placed: Order_Placed, cancelled: Order_Cancelled })
// invoice.workers.ts: durable, a job in the outbox, retried with backoff (5 attempts)
deps.order.events.placed.subscribe((order, event) => invoices.open(order, event.id), {
  strategy: 'handler',
  queue: 'invoice.open.on.order.placed',             // <module>.<use case>.on.<module>.<event>
  when: (order: OrderDTO) => order.total > 0,        // which events get a job, from the payload only
})
// may be lost (a log line, a cache): in memory, after the commit, no queue
deps.order.events.placed.subscribe(order => log(order.id), { strategy: 'fire-and-forget' })
// a schedule: an event told once per tick (cron, UTC), subscribed like any event
this.nightly = base.schedules.define('order.nightly', '0 3 * * *')
orders.nightly.subscribe(() => orders.closeStale(), { strategy: 'handler', queue: 'order.closeStale.on.order.nightly' })
```

- An event is told only after its save commits, and only with a change (else `EventWithoutChange`). Payload is JSON (`type`, not `interface`), only grows; `updated` carries `{ dto, changes, previous }`.
- A handler calls one use case of its own module. It runs with no actor and no scope: read who from the payload, enter the scope (`workspaceScope.run(...)`) or `runAsActor` yourself.
- Idempotency: a job may run twice; key what must happen once by the event's id (`event.id`, the same on every run), e.g. a mail key or a row id.
- Renaming a queue leaves its pending jobs behind. A worker running late reads again what it is about.

## Routes

```ts
export function registerOrderRoutes(base: ShopBase, orders: Order_Module, deps: Order_Deps): void {
  const workspace = base.http.group('/workspaces/:workspaceId', async (request, next) =>
    workspaceScope.run(await deps.member.enter(request.params.workspaceId), next))
  workspace.get('/orders', async request => Response.json(await orders.list(pageRequestFrom(request))))
  workspace.post('/orders', async request => Response.json(await orders.place(await request.json()), { status: 201 }),
    { idempotency: { table: base.store.table<KeptAnswer>('idempotency_key') } })
  base.http.get('/catalog', async () => Response.json(await orders.catalog()), { public: true })
  base.oauth.post('/oauth/register', handler, { cors: { origin: '*' }, onError: error => toOauthErrorResponse(error, 'invalid_request') })
}
```

- Pass the body as it came: `await request.json()`, never `as X` (`newt/route-body`).
- Never catch: a thrown domain error becomes `{ error, code }` with its base class's status; zod's a 400 `validation`.
- Every route needs a session unless `{ public: true }`. Other origins only with `cors`, never cookies. `idempotency` for a POST that creates (client sends `Idempotency-Key`). `onError` for a wire format of its own; a router at the root is `new HttpRouter({ prefix: '' })`.

## Scopes and tenants

```ts
export const workspaceScope = defineScope<{ workspaceId: string }>('workspace', { missing: () => new Error('No workspace here') })
export const currentWorkspaceId = () => workspaceScope.current().workspaceId
```

- A route group's middleware enters the scope after checking membership; workers, scripts and MCP tools enter it with `workspaceScope.run(value, fn)`.
- Every repository of tenant rows says `scope: { field, current }`; Kysely queries add `.where('workspaceId', '=', currentWorkspaceId())`.
- Test isolation: write a test where a second tenant cannot read, change or list the first's rows (expect a 404).

## Errors

One class per file in `errors/`, a stable `code`, its base deciding the status: `NotFoundError` 404, `ValidationError` 400, `ReferenceNotFound` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `ConflictError` 409.

```ts
export class OrderNotFound extends NotFoundError {
  readonly code = 'order.not_found'
  constructor(id: string) { super(`There is no order ${id}`) }
}
```

## When newt throws

| Message or error | Means | Do |
|---|---|---|
| `[write rule] X writes to Y outside a worker` | A use case saved in another module from a request. | Move the write to a worker on an event of yours; or `writesTo: ['y']` with the reason. |
| `[write rule] … one module per transaction` | Two modules saved in one transaction (a save hook calling another module). | Save the second after the first commits, from a worker. |
| `[guard rule] X reads T in a save that guards nothing` | A save reads rows but names no guard. | Add `guard: ['<what the rule protects>:<keys>']`, or `guard: []` if no rule needs it. |
| `ConcurrencyConflict` (409, `concurrency_conflict`) | Someone saved it since it was read. | Nothing: the use case runs again. Keep it free of side effects before the save. |
| `DuplicateValue` (409, `duplicate_value`) | A unique index refused the row. | Check first in the use case with your own error; keep the index. |
| `SaveRolledBack` | An entity of a save that rolled back is saved again. | Read it again and change that one. |
| `EventWithoutChange` | An event tracked with no change to save. | Change what it tells (a status, a date) with it, or do not track it. |
| `InvalidEntity` (500) | The entity broke its own schema: a bug. | Validate input in the use case; fix the entity method. |
| `UnknownEntityField`, `DeletedEntityNotChangeable`, `EntityAlreadyDeleted`, `NewEntityNotDeletable` | An entity method misused: a field its schema lacks, a change or delete after delete, deleting one never saved. | Fix the entity's method or the use case's order. |
| `…schema keeps fields it does not name` | Entity schema is `looseObject`/`catchall`/`passthrough`. | Use `z.object` or `z.strictObject`. |
| `NoActor` (401, `not_signed_in`) | `currentActor()` outside an actor (a handler, a script). | Read who from the payload; `runAsActor(actor, fn)`. |
| `… belongs to <field> '…', not to the current one` | Saving an entity of another scope. | Enter the right scope; never move rows across scopes. |
| `idempotency_key_in_use` 409 / `idempotency_key_reused` 422 | Same key while running / with another body. | The client sends a new key per submit. |

## The lint (newt-eslint)

| Rule | Says |
|---|---|
| `newt/module-anatomy` | Only the files and folders above, named after the module. |
| `newt/module-boundaries` | Another module only through its module, schema, events, errors, value objects. |
| `newt/queue-name` | A handler's queue is `<module>.<use case>.on.<module>.<event>`, its callback calls that use case. |
| `newt/schema-imports` | A `<m>.schema.ts` takes from newt only `newt/contract`. |
| `newt/context-boundaries` | A context imports only the contexts its `uses` lists. |
| `newt/use-case` | Every public method of a `Module` is `@UseCase`; others are `private`. |
| `newt/route-body` | No `await request.json() as X` in a `*.routes.ts`: the use case parses `unknown`. |
| `no-restricted-syntax` | No `transaction` in a module: write through `save`/`saveRows`. |
| `@typescript-eslint/no-floating-promises` | Await every promise. |

Never silence a rule to pass; the one accepted `eslint-disable-next-line newt/queue-name` is a test's own subscription, with the reason.

## Testing

```ts
const clock = { now: () => new Date(time) }                      // move time by hand
const base = new Base({ name: 'shop', store: await SqliteStore.open({ path: ':memory:', migrations }), clock })
await runAsActor({ userId: 'ana' }, () => workspaceScope.run({ workspaceId: 'w1' }, () => orders.place({ total: 10 })))
await base.jobs.idle()                                           // wait for workers: never a sleep
await base.jobs.runAsWorker(() => invoices.open(order, id))      // do by hand what a worker would
time += DAY_MS; await base.schedules.tick()                      // a schedule's tick, now
```

- `newt/testing`: `freePort()`, and `browser(baseUrl)`, a `fetch` that keeps cookies and never follows redirects, for HTTP tests.
- `bun test`; tests beside the code. Test the hard cases: at once (`Promise.allSettled`), twice, refused, limits crossed, another tenant.
- A port is proved by a contract suite every adapter runs (`describeStoreContract`).

## Migrations

A change of shape is a new migration file per dialect (`migrations/sqlite/00002_x_up.sql`, `migrations/postgres/…`); never edit an applied one (checksums). Unique values among live rows: a partial unique index.

## Commands

```sh
bun check          # types (tsc's errors)
bun test           # tests
bun run lint       # eslint with newt-eslint's preset
```

## Definition of done

- [ ] `bun check`, `bun test` and the lint pass, with no rule silenced.
- [ ] Every new module has the anatomy above, one responsibility, and a test.
- [ ] Every public module method is a `@UseCase`; inputs from clients are `unknown`, parsed by the input schema.
- [ ] Every repository says its `scope` (or `'none'` with a reason); a test shows another tenant sees nothing.
- [ ] One save per use case; rules over rows in `after` with a narrow `guard`.
- [ ] Writes into other modules and anything irreversible happen in `handler` workers, idempotent by event id, queue named by the rule.
- [ ] No `new Date()`, no user id passed by hand, no list unbounded.
- [ ] Schema changes come with new migrations for every dialect the app runs.
- [ ] Errors are domain errors with stable codes; routes never catch.
