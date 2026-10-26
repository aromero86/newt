# The backoffice

cooper's staff need a console of their own: every workspace, every account, who is of
the staff, and a few numbers about how cooper is used. None of that belongs to a
workspace, and none of it is new data: auth keeps the accounts and the workspaces,
boards keeps what is in them. This chapter builds `backoffice`, the third context. It
keeps almost nothing, and puts each screen together from the use cases of the contexts
that know.

On the way you meet four things newt gives you for a console like this: an access with
no tenant, Kysely for the counts a table cannot say, the analytics port for metrics,
and a tracer to see what a request did.

(The backoffice's UI lives in `cooper/frontend/backoffice`. This guide does not cover it.)

## Staff: an access with no tenant

In auth, an access says who may enter which product, and for which tenant. A member of
Acme has access to the product `cooper` for the tenant Acme. Someone of the staff has
access to the product `backoffice` for **no tenant**: `tenantId` is `null`. The staff
look at all of cooper, not at one workspace.

The backoffice is a product of auth's, with its own OAuth client, like boards:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
/** The backoffice as a product of auth's: its OAuth client, and what its staff have access to. */
export const BACKOFFICE_PRODUCT = 'backoffice'
```

Its `staff` module keeps nothing. To know whether someone is of the staff, it asks auth
every time:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.module.ts
/**
 * The signed-in person is of the staff, or nothing of the backoffice answers them:
 * what every route of its API checks first (`staffRoutes`).
 */
@UseCase()
async enter(): Promise<void> {
  if (!await this.isStaff(currentActor().userId)) throw new NotStaff()
}

// …

@UseCase()
async isStaff(userId: string): Promise<boolean> {
  return (await this.deps.access.check(userId, this.options.productId, null)) !== null
}
```

Why ask every time, and not keep a flag in the backoffice's session? Because an access
taken away must count at once. If the session remembered "staff" for 30 days, someone
removed from the staff would keep the console for 30 days.

There are two checks, in two places:

- **At sign-in, in auth.** The product `backoffice` has `access: 'granted'`: auth
  refuses to sign in anyone without access to it. They never get a session.
- **On every request, in the backoffice.** `staff.enter` runs before each route. This
  is what makes a revoke count at once, for someone who signed in before it.

## One middleware for every route

Every module of the backoffice registers its routes on the same group, whose
middleware calls `staff.enter`:

```ts
// cooper/backend/contexts/backoffice/staff-routes.ts
export function staffRoutes(base: CooperBase, staff: Staff_Module) {
  return base.http.group('', async (_request, next) => {
    await staff.enter()
    return next()
  })
}
```

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.routes.ts
export function registerWorkspaceRoutes(base: CooperBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?name=acme`: a workspace's name, whole.
  routes.get('/workspaces', async request => {
    const name = new URL(request.url).searchParams.get('name') || undefined
    return Response.json(await workspaces.list({ name }, pageRequestFrom(request)))
  })

  routes.get('/workspaces/:workspaceId', async request => Response.json(await workspaces.get(request.params.workspaceId)))
  // …
}
```

The group's prefix is `''`: the backoffice has no scope like boards' workspace
([chapter 5](./05-who-and-where)), so its group only adds the check. No use case below
has to check again, and no route can forget to.

The answers follow from who asks:

| Who asks | Status | Why |
|---|---|---|
| Nobody signed in | 401 | The router refuses every route that is not `public`. |
| Someone signed in, not of the staff | 403 | `NotStaff`, a `ForbiddenError`. |
| The staff, for something that is not there | 404 | A workspace or account that does not exist. |

In boards, a workspace you do not belong to is a 404: saying "forbidden" would tell a
stranger that the workspace exists. The backoffice answers 403 instead, and the error
says why:

```ts
// cooper/backend/contexts/backoffice/modules/staff/errors/not-staff.ts
/**
 * Someone signed in who is not of the staff (any more). A 403, not a 404: the
 * backoffice is no secret to whoever signed in to it, and refusing them says nothing
 * of any workspace or account. What is inside is answered as usual: a workspace that
 * does not exist is a 404.
 */
export class NotStaff extends ForbiddenError {
  readonly code = 'staff.not_staff'
  constructor() {
    super('Only Cooper\'s staff may use the backoffice')
  }
}
```

The 403 comes before anything is read, for every path. So it gives away nothing about
which workspaces or accounts exist.

### Check it

The backoffice's API test replaces the session's authenticator with an `x-user`
header, and asks every route as nobody, as staff, and as someone just revoked:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.test.ts
test('answers only the staff: 401 without a session, 403 to anyone else, at once after a revoke', async () => {
  const sam = await t.staffMember('Sam')
  const ana = await t.staffMember('Ana')

  for (const path of ['/api/session', '/api/workspaces', '/api/users', '/api/staff', '/api/metrics']) {
    expect((await get(path)).status).toBe(401)
    expect((await get(path, ana.id)).status).toBe(200)
  }
  expect(await (await get('/api/session', ana.id)).json()).toMatchObject({ user: { id: ana.id, name: 'Ana', email: 'ana@cooper.test' } })

  await t.as(sam, () => t.modules.staff.revoke(ana.id))
  for (const path of ['/api/session', '/api/workspaces', '/api/users/' + sam.id, '/api/staff', '/api/metrics']) {
    const response = await get(path, ana.id)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'staff.not_staff' })
  }
})
```

And `backoffice-sign-in.test.ts` checks the other half: auth refuses to let someone
who is not of the staff say yes to the backoffice (`oauthGrant.no_access`, a 403).

## Composing reads from two contexts

A workspace's page in the backoffice shows its name, its admin, how many members and
boards it has, and how many cards. That is auth's tenants, accesses and accounts, and
boards' boards and cards. The `workspace` module of the backoffice owns none of it. It
lists, in its deps, the modules that do:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.deps.ts
/**
 * What a workspace's page is made of, each part asked to the module that keeps it:
 * auth's tenants, accesses and accounts, and boards' boards and cards. Only their use
 * cases, never their repositories (ch. 23).
 */
export interface Workspace_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  tenant: Tenant_Module
  access: Access_Module
  user: AuthUser_Module
  board: Board_Module
  /** How many cards each workspace and board has: Kysely's counts, in boards (ch. 26). */
  card: Card_Module
}
```

The context hands them over when it initializes its modules. auth and boards are
opened first, and the backoffice receives them:

```ts
// cooper/backend/contexts/backoffice/initialize-modules.ts
const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
```

Each use case is a few calls to those modules, run side by side where they do not
depend on each other:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.module.ts
@UseCase()
async get(workspaceId: string): Promise<WorkspaceDetailDTO> {
  const tenant = await this.deps.tenant.get(workspaceId)
  const [[summary], members, boards] = await Promise.all([
    this.summaries([tenant]),
    this.deps.access.listForTenant(workspaceId, { size: 1 }),
    this.deps.board.listOf(workspaceId, { size: 1 }),
  ])
  return { ...summary!, members: members.total, boards: boards.total }
}
```

`tenant.get` comes first and alone: a workspace that does not exist throws auth's
`TenantNotFound`, a 404, before anything else runs. To count members and boards it asks
for a page of one and reads its `total`. No list is returned whole, not even to
another context.

A list of workspaces needs, for each one, its admin's name and its number of cards.
Asking for them row by row would be one call per workspace on the page. Instead, the
module asks once for the whole page:

```ts
// cooper/backend/contexts/backoffice/modules/workspace/workspace.module.ts
/** Workspaces as the list shows them: two calls for the whole page, its admins and its cards. */
private async summaries(tenants: TenantDTO[]): Promise<WorkspaceSummaryDTO[]> {
  const [admins, counts] = await Promise.all([
    this.people(tenants.map(tenant => tenant.createdBy)),
    this.deps.card.countByWorkspace(tenants.map(tenant => tenant.id)),
  ])
  const cards = new Map(counts.map(count => [count.workspaceId, count.cards]))
  return tenants.map(tenant => ({
    id: tenant.id,
    name: tenant.name,
    createdAt: tenant.createdAt,
    admin: admins.get(tenant.createdBy) ?? null,
    cards: cards.get(tenant.id) ?? 0,
  }))
}

private async people(userIds: string[]): Promise<Map<string, PersonDTO>> {
  const users = await this.deps.user.getMany(userIds)
  return new Map(users.map(user => [user.id, { id: user.id, name: user.name, email: user.email }]))
}
```

That is why auth offers `user.getMany` and boards offers `card.countByWorkspace` with a
list of ids: a context that others read from offers its reads in batches.

### Writing into auth

The backoffice also changes things: it makes someone staff, or takes it away. It does
so through auth's own use cases:

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.module.ts
@UseCase()
async grant(input: StaffGrantDTO): Promise<StaffMemberDTO> {
  const { email } = StaffGrantSchema.parse(input)
  const user = await this.deps.user.findByEmail(email)
  if (!user) throw new StaffAccountNotFound(email)
  const access = await this.deps.access.grant({ userId: user.id, productId: this.options.productId, tenantId: null })
  return { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
}
```

This is not a write to another module outside a worker. The write rule is per context
([chapter 17](./17-modules-talk)): a use case called from another context is that
context's API, the root of what happens in it. `access.grant` is the first use case of
its chain in auth, and auth checks its own rules there. A test proves that auth does
not trust the backoffice: someone who is not of the staff calling `staff.grant` gets
auth's 403.

```ts
// cooper/backend/contexts/backoffice/modules/staff/staff.test.ts
test('only the staff grant: auth checks it again', async () => {
  const ana = await t.signUp('Ana')
  await t.signUp('Bob')

  await expect(t.as(ana, () => t.modules.staff.grant({ email: 'bob@cooper.test' }))).rejects.toMatchObject({ status: 403 })
})
```

## Counting with Kysely, in boards

How many cards does each workspace have? `TableRepository` has `count(criteria)`, but
that is one query per workspace. What you want is one query that groups: `SELECT
workspace_id, COUNT(*) … GROUP BY workspace_id`. Criteria cannot say "group by".

The backoffice cannot run that query itself. The `card` table is boards', and only
boards' card repository touches it. So boards offers the count as a use case, and its
repository runs it with **Kysely**, a typed query builder newt runs on the store's
connection.

boards' base gets a Kysely instance with `kyselyFor`, typed with boards' tables:

```ts
// cooper/backend/contexts/boards/boards-base.ts
/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (counts by workspace, a search in the text of the
 * cards). Kysely needs a SQL store: `boards` opens on SQLite, and would open on
 * Postgres or MySQL the same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
```

```ts
// cooper/backend/contexts/boards/boards-database.ts
export type BoardsDatabase = {
  board: SqliteRow<BoardRow>
  column: SqliteRow<ColumnRow>
  card: SqliteRow<CardRow>
}
```

The repository uses it:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * How many cards each of these workspaces has, by one query that groups them (ch.
 * 26). Across workspaces on purpose: for the staff's backoffice, which looks at
 * all of them, never for a workspace's own work.
 */
async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
  if (workspaceIds.length === 0) return []
  const rows = await this.base.db
    .selectFrom('card')
    .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
    .where('workspaceId', 'in', workspaceIds)
    .groupBy('workspaceId')
    .execute()
  const counts = new Map(rows.map(row => [row.workspaceId, Number(row.cards)]))
  return workspaceIds.map(workspaceId => ({ workspaceId, cards: counts.get(workspaceId) ?? 0 }))
}

/** How many cards each board of the current workspace has: boards without any are not there. */
async countByBoard(): Promise<CardCountByBoard[]> {
  const rows = await this.base.db
    .selectFrom('card')
    .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
    .where('workspaceId', '=', currentWorkspaceId())
    .groupBy('boardId')
    .orderBy('boardId')
    .execute()
  return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
}
```

And the module offers them to other contexts:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** For other contexts (the staff's backoffice): how many cards each of these workspaces has. */
@UseCase()
async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
  return this.repo.countByWorkspace([...new Set(workspaceIds)])
}

/** For other contexts: how many cards each board of a workspace has. */
@UseCase()
async countByBoard(workspaceId: string): Promise<CardCountByBoard[]> {
  return runInWorkspace(workspaceId, () => this.repo.countByBoard())
}
```

What to know about Kysely in newt:

- **Fields are named as in the row** (`workspaceId`), not as the column
  (`workspace_id`). Kysely translates on the way. Tables keep their names (`card`).
- **It runs in the transaction in progress**, like everything the repository does.
  Kysely's own transactions are refused: a transaction is always the store's. A
  write with Kysely goes inside `saveRows` (as `card.purgeWorkspace` does).
- **A count may come back as text** on Postgres (and a sum on Postgres and MySQL):
  pass it through `Number(…)`, as the code above does, and it works on all three.
- **Kysely does not know the scope.** The repository's
  `scope: { field: 'workspaceId', current }` adds the workspace to every criteria
  query, but a Kysely query is yours: write the workspace yourself, as
  `countByBoard` does with `currentWorkspaceId()`. `countByWorkspace` leaves it out on
  purpose, and its comment says so.

### The portability rule

Each step down this list ties you a little more to a store. Go down only when the step
above cannot do it:

1. **`TableRepository` and criteria**, by default. They work on every store, files
   included.
2. **Kysely**, for what criteria cannot say. It works on every SQL store: SQLite,
   Postgres, MySQL.
3. **A store's own SQL**, only when there is no other way. Keep it in one place, and
   mark it with a comment that says which store and why.

boards stays on step 2. You will see a step 3 in the next section, marked as the rule
asks.

## Metrics: a projection through the analytics port

The overview of the backoffice shows cards created per day, workspaces opened, people
signed up. You could count them in auth and boards each time. But a count over all of
cooper, by day, is the kind of query that grows with the data, and it would run on the
databases that serve the users.

The backoffice keeps its numbers apart, as a **projection**: a copy of the data, made
for reading. The truth stays in auth and boards, with their transactions. Workers
follow their events and append a row for each thing that happened.

newt defines a port for this, `Analytics`, with a single way to write: append.

```ts
// packages/newt/port-analytics/analytics.ts
export interface Analytics {
  /** Adds rows to a dataset; a row whose id is already there is left out. */
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
```

- **Rows are only added.** A row, once in, never changes or goes.
- **Every row has an `id`.** A row whose id is already in its dataset is left out, so
  a worker that runs twice counts once.
- **Reading is each adapter's own**, in its database's language: analytical queries
  do not fit in criteria.

newt brings no adapter yet. cooper writes a small one on SQLite, in `shared/`, and
keeps it in the backoffice's own database:

```ts
// cooper/backend/shared/analytics/sqlite-analytics.ts
export class SqliteAnalytics implements Analytics, AnalyticsCounts {

  constructor(private readonly store: SqliteStore) {}

  async append(dataset: string, rows: AnalyticsRow[]): Promise<void> {
    if (rows.length === 0) return
    await this.store.transaction(() => {
      const insert = this.store.connection.query('INSERT OR IGNORE INTO analytics_row (dataset, id, data) VALUES (?, ?, ?)')
      for (const row of rows) insert.run(dataset, row.id, JSON.stringify(row))
    })
  }

  // …

  async countBy(dataset: string, field: string, options: { from?: string } = {}): Promise<AnalyticsCount[]> {
    if (!FIELD.test(field)) throw new Error(`'${field}' is not a field a row may have`)
    // SQLite only: `json_extract` reads a field of the JSON; DuckDB or ClickHouse would read a column.
    const found = this.store.connection.query(`
      SELECT json_extract(data, ?) AS value, COUNT(*) AS count
      FROM analytics_row
      WHERE dataset = ? AND json_extract(data, ?) >= ?
      GROUP BY value
      ORDER BY value
    `).all(`$.${field}`, dataset, `$.${field}`, options.from ?? '') as { value: unknown, count: number }[]
    return found.map(row => ({ value: String(row.value), count: row.count }))
  }
```

There is the step 3 of the portability rule: SQL of one store, in one place, marked.
`INSERT OR IGNORE` with the primary key `(dataset, id)` keeps the port's promise that a
repeated row is left out.

Reading is not in newt's port, so cooper declares the questions it asks in an
interface of its own. The metric module takes both, and never knows which adapter
answers:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric-options.ts
export type Metric_Options = {
  /** Where they are kept: appended to by the workers, read by the overview. */
  analytics: Analytics & AnalyticsCounts
  /** How many days the overview goes back, today included. */
  days: number
}
```

The workers subscribe to events of auth and boards, each with a `handler`:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.workers.ts
/**
 * What the metrics count, each from an event of another context: a `handler`, a job
 * saved with what happened, in that context's outbox and run by its worker until it
 * succeeds. Not `fireAndForget`: a number lost when the server stops would be wrong
 * for good. Each one appends a row by the id of what it counts, so running it twice
 * counts once (ch. 28).
 */
export function registerMetricWorkers(metrics: Metric_Module, deps: Metric_Deps): void {
  deps.card.events.created.subscribe(card => metrics.recordCard(card), {
    strategy: 'handler',
    queue: 'metric.recordCard.on.card.created',
  })
  deps.tenant.events.created.subscribe(tenant => metrics.recordWorkspace(tenant), {
    strategy: 'handler',
    queue: 'metric.recordWorkspace.on.tenant.created',
  })
  deps.user.events.signedUp.subscribe(user => metrics.recordSignUp(user), {
    strategy: 'handler',
    queue: 'metric.recordSignUp.on.user.signedUp',
  })
}
```

Each use case appends one row, by the id of what it counts:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.module.ts
/** A card was made, in a board of a workspace. */
@UseCase()
async recordCard(card: CardDTO): Promise<void> {
  await this.options.analytics.append(METRIC_DATASETS.cardCreated, [{ id: card.id, workspaceId: card.workspaceId, day: dayOf(card.createdAt) }])
}
```

Notice where these jobs live. A subscription to `card.created` is written in the
transaction that publishes the event, so its job is in **boards'** outbox, run by
boards' worker. The jobs for `tenant.created` and `user.signedUp` are in **auth's**.
The backoffice's own outbox holds none of them. That matters when you wait for them in
a test ([chapter 25](./25-tests)).

The analytics table comes from a migration that `shared/analytics` keeps and the
backoffice copies into its own folder, as it does with the web session's
([chapter 24](./24-migrations)).

### Check it

The numbers are a moment behind. The test says so, then waits for the workers:

```ts
// cooper/backend/contexts/backoffice/modules/metric/metric.test.ts
test('counts what auth and boards tell, once their workers ran', async () => {
  const sam = await t.staffMember('Sam')
  const ana = await t.signUp('Ana')
  const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
  await t.board(ana, acme.id, 'Roadmap', ['One', 'Two', 'Three'])

  // Nothing yet: the numbers are a projection, a moment behind.
  expect((await t.as(sam, () => t.modules.metric.overview())).totals).toEqual({ cards: 0, workspaces: 0, signUps: 0 })

  await t.settled()

  const { cards } = (await t.boards.modules.card.countByWorkspace([acme.id]))[0]!
  expect(cards).toBeGreaterThanOrEqual(3)
  const overview = await t.as(sam, () => t.modules.metric.overview())
  expect(overview.totals).toEqual({ cards, workspaces: 1, signUps: 2 })
  // …
})

test('counts a card once, however many times its worker runs', async () => {
  const card = { id: '0190a0a0-0000-7000-8000-000000000001', workspaceId: 'w', createdAt: new Date().toISOString() } as CardDTO
  await t.modules.metric.recordCard(card)
  await t.modules.metric.recordCard(card)

  const sam = await t.staffMember('Sam')
  expect((await t.as(sam, () => t.modules.metric.overview())).totals.cards).toBe(1)
})
```

`newt/port-analytics/contract` also has `describeAnalyticsContract`, the suite every
adapter must pass. `sqlite-analytics.test.ts` runs it on cooper's adapter.

## Seeing what a request did: a tracer

Every call to a use case is a **span** of a trace, named after it (`workspace.get`),
with its context and module. A use case called from another is a span inside its
caller's. A retry after a conflict is noted as an event, and an error that is not a
domain error marks the span.

newt records nothing unless you hand the base a `Tracer`. cooper has one that writes to
the console, in `shared/observability`, and the backoffice uses it when `COOPER_TRACE`
is `1`:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps): Promise<Backoffice_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new CooperBase({ name: 'backoffice', store, tracer: config.trace ? new ConsoleTracer() : undefined })
  return new Backoffice_Context(base, initializeModules(base, config, deps), config)
}
```

The tracer implements newt's interface, the same one an OpenTelemetry adapter would:

```ts
// cooper/backend/shared/observability/console-tracer.ts
export class ConsoleTracer implements Tracer {

  /** The span running now, which a span started inside it is a child of. */
  private readonly active = new AsyncLocalStorage<TracedSpan>()

  constructor(private readonly write: TraceWriter = line => console.log(line)) {}

  async startActiveSpan<T>(name: string, attributes: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
    if (name.startsWith('job.')) return fn({ setError() {}, addEvent() {}, end() {} })

    const parent = this.active.getStore()
    const traced: TracedSpan = { name, attributes, started: performance.now(), ms: 0, error: null, events: [], children: [] }
    parent?.children.push(traced)
    // …
    try {
      return await this.active.run(traced, () => fn(span))
    } finally {
      if (traced.ms === 0) span.end()
      // A trace is written whole, once the span that began it ends.
      if (!parent) this.print(traced, 0)
    }
  }
  // …
}
```

The job worker has spans of its own, named `job.…` (`job.claim` runs every few
seconds). This tracer leaves them out: what a job does is a use case, and that one is
written.

Its test shows what you get:

```ts
// cooper/backend/shared/observability/console-tracer.test.ts
expect(lines.map(line => line.replace(/\d+\.\d ms/, 'n ms'))).toEqual([
  '[trace] backoffice workspace.get n ms',
  '[trace]   backoffice staff.enter n ms (conflict.retry {"attempt":1})',
  '[trace]   broken n ms (error: disk full)',
])
```

To try it, start cooper with the variable set and open the backoffice:

```bash
COOPER_TRACE=1 bun run cooper
```

Each context has its own base, so each has its own tracer, or none. cooper gives one
only to the backoffice. When `workspace.get` calls auth's `tenant.get`, that call runs
on auth's invocations, which record nothing: you see the backoffice's use cases, not
auth's or boards'. To trace them too, hand a tracer to their bases as well.

## In short

- Access with no tenant (`tenantId: null`) is access to a whole product: cooper's
  staff.
- Check who may enter on every request, through a group's middleware. Do not keep it
  in the session: a revoke must count at once.
- 401 is nobody signed in, 403 is someone who may not, 404 is something that is not
  there. Choose 404 over 403 when a 403 would reveal that something exists.
- A context that reads others composes their use cases, a few calls per page, never
  one per row. Offer reads in batches (`getMany`, `countByWorkspace(ids)`).
- What criteria cannot say goes to Kysely, in the repository that owns the table.
  Kysely does not apply the scope: write it yourself.
- `TableRepository` by default, Kysely for the rest, a store's own SQL only when there
  is no other way, kept in one place and marked.
- Metrics are a projection: `handler` workers append rows with ids, so a repeated job
  counts once.
- A tracer goes on a context's base. Without one, nothing is recorded.
